import { Env, Item } from './types';
import { sendMessage } from './telegram';
import { addInterval, formatTaipei, rollToTaipeiDate } from './timeparse';

const TYPE_EMOJI: Record<string, string> = {
  task: '✅', goal: '🎯', idea: '💡', reminder: '🔔', inbox: '📥',
};

export async function checkReminders(env: Env): Promise<void> {
  const now = new Date().toISOString();

  // 時間到（reminder 的 remind_at 或 task/goal 的 due_at）且還沒處理過的，一次跳出
  // 完成／刪除 按鈕；沒按就當作沒完成，隔天早上由 rolloverUnfinished 排入當天。
  const { results: due } = await env.DB.prepare(
    `SELECT * FROM items
     WHERE status = 'active'
     AND (
       (remind_at IS NOT NULL AND remind_at <= ?)
       OR (due_at IS NOT NULL AND due_at <= ?)
     )`
  )
    .bind(now, now)
    .all<Item>();

  for (const item of due) {
    const chatId = await getChatId(env, item.raw_message_id);
    if (!chatId) continue;

    const emoji = TYPE_EMOJI[item.type] || '📄';
    const label = item.remind_at && item.remind_at <= now ? '提醒' : '到期';
    let msg = `🔔 *${label}*\n\n${emoji} ${item.title || item.content || '(無內容)'}`;
    if (item.repeat_freq) {
      const remain = item.repeat_remaining !== null ? `，剩 ${item.repeat_remaining} 次` : '（無限重複）';
      msg += `\n🔁 ${item.repeat_freq === 'daily' ? '每天' : '每週'}提醒${remain}`;
    }

    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg, [
      [
        { text: '✅ 完成', callback_data: `done:${item.id}` },
        { text: '🗑 刪除', callback_data: `delete:${item.id}` },
      ],
    ]);

    await env.DB.prepare(
      `UPDATE items SET status = 'notified', notified_at = ? WHERE id = ?`
    )
      .bind(now, item.id)
      .run();
  }
}

/**
 * 標記完成。若項目有設定重複頻率且次數還沒用完，改為推進到下一次（保留 active），
 * 次數用完或沒有設定重複才真的變成 done。回傳給使用者看的訊息；找不到項目回傳 null。
 */
export async function completeItem(env: Env, itemId: number): Promise<string | null> {
  const item = await env.DB.prepare(
    `SELECT * FROM items WHERE id = ? AND status IN ('active', 'notified')`
  )
    .bind(itemId)
    .first<Item>();
  if (!item) return null;

  const now = new Date().toISOString();

  const exhausted = !item.repeat_freq || (item.repeat_remaining !== null && item.repeat_remaining <= 1);
  if (exhausted) {
    await env.DB.prepare(
      `UPDATE items SET status = 'done', completed_at = ? WHERE id = ?`
    )
      .bind(now, itemId)
      .run();
    return item.repeat_freq
      ? `✅ #${itemId} 已完成（重複提醒已全部完成）`
      : `✅ #${itemId} 已完成`;
  }

  const base = item.remind_at ?? item.due_at ?? now;
  const nextAt = addInterval(base, item.repeat_freq!);
  const newRemaining = item.repeat_remaining !== null ? item.repeat_remaining - 1 : null;

  if (item.remind_at) {
    await env.DB.prepare(
      `UPDATE items SET status = 'active', notified_at = NULL, remind_at = ?, repeat_remaining = ? WHERE id = ?`
    )
      .bind(nextAt, newRemaining, itemId)
      .run();
  } else {
    await env.DB.prepare(
      `UPDATE items SET status = 'active', notified_at = NULL, due_at = ?, repeat_remaining = ? WHERE id = ?`
    )
      .bind(nextAt, newRemaining, itemId)
      .run();
  }

  const remainText = newRemaining !== null ? `，還剩 ${newRemaining} 次` : '';
  return `✅ #${itemId} 這次完成${remainText}，下次：${formatTaipei(nextAt)}`;
}

/** 延期一天：保留原本的時分，日期往後推一天。回傳給使用者看的訊息；找不到項目回傳 null。 */
export async function postponeItem(env: Env, itemId: number): Promise<string | null> {
  const item = await env.DB.prepare(
    `SELECT * FROM items WHERE id = ? AND status IN ('active', 'notified')`
  )
    .bind(itemId)
    .first<Item>();
  if (!item) return null;

  const base = item.remind_at ?? item.due_at;
  if (!base) return null;

  const nextAt = addInterval(base, 'daily');

  if (item.remind_at) {
    await env.DB.prepare(
      `UPDATE items SET status = 'active', notified_at = NULL, remind_at = ? WHERE id = ?`
    )
      .bind(nextAt, itemId)
      .run();
  } else {
    await env.DB.prepare(
      `UPDATE items SET status = 'active', notified_at = NULL, due_at = ? WHERE id = ?`
    )
      .bind(nextAt, itemId)
      .run();
  }

  return `📅 #${itemId} 已延到 ${formatTaipei(nextAt)}`;
}

/**
 * 未完成事項排入今天：時間點（remind_at 或 due_at）落在今天（台北）之前、還沒完成／刪除的，
 * 保留原本時分、日期移到今天，狀態回到 active，時間到會再跳一次按鈕。回傳被順延的項目。
 */
export async function rolloverUnfinished(env: Env, todayTaipei: string): Promise<Item[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM items
     WHERE status IN ('active', 'notified')
     AND (remind_at IS NOT NULL OR due_at IS NOT NULL)`
  ).all<Item>();

  const rolled: Item[] = [];
  for (const item of results) {
    const remindAt = item.remind_at ? rollToTaipeiDate(item.remind_at, todayTaipei) : null;
    const dueAt = item.due_at ? rollToTaipeiDate(item.due_at, todayTaipei) : null;
    if (!remindAt && !dueAt) continue;

    const next = { remind_at: remindAt ?? item.remind_at, due_at: dueAt ?? item.due_at };
    await env.DB.prepare(
      `UPDATE items SET status = 'active', notified_at = NULL, remind_at = ?, due_at = ? WHERE id = ?`
    )
      .bind(next.remind_at, next.due_at, item.id)
      .run();
    rolled.push({ ...item, ...next, status: 'active', notified_at: null });
  }
  return rolled;
}

async function getChatId(env: Env, rawMessageId: number | null): Promise<number | null> {
  if (!rawMessageId) return parseInt(env.ALLOWED_USER_ID, 10) || null;

  const row = await env.DB.prepare(
    `SELECT COALESCE(chat_id, user_id) AS chat_id FROM raw_messages WHERE id = ?`
  )
    .bind(rawMessageId)
    .first<{ chat_id: number }>();

  return row?.chat_id ?? parseInt(env.ALLOWED_USER_ID, 10) ?? null;
}

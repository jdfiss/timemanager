import { Env, Item } from './types';
import { sendMessage } from './telegram';
import { rolloverUnfinished } from './reminder';
import { formatTaipei } from './timeparse';
import { getTodayCalendar } from './calendar';

const TYPE_EMOJI: Record<string, string> = {
  task: '✅', goal: '🎯', idea: '💡', reminder: '🔔', inbox: '📥',
};

const MAX_ITEM_MESSAGES = 30;

const SLOTS = [
  { name: 'morning', hour: 7, greeting: '🌅 早安！以下是你目前的待辦事項：' },
  { name: 'evening', hour: 22, greeting: '🌙 晚安！今日事項回顧：' },
] as const;

function getTaiwanHour(now: Date): { hour: number; dateStr: string } {
  const tw = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return {
    hour: tw.getUTCHours(),
    dateStr: tw.toISOString().slice(0, 10),
  };
}

export async function checkDigest(env: Env): Promise<void> {
  const now = new Date();
  const { hour, dateStr } = getTaiwanHour(now);

  for (const slot of SLOTS) {
    if (hour < slot.hour) continue;

    const row = await env.DB.prepare(
      `SELECT last_sent_date FROM digest_log WHERE slot = ?`
    ).bind(slot.name).first<{ last_sent_date: string }>();

    if (row?.last_sent_date === dateStr) continue;

    // 早上先把之前沒完成的排進今天，再列今日清單
    const rolled = slot.name === 'morning' ? await rolloverUnfinished(env, dateStr) : [];
    await sendDigest(env, slot.greeting, new Set(rolled.map(i => i.id)), slot.name === 'morning' ? dateStr : undefined);

    await env.DB.prepare(
      `INSERT INTO digest_log (slot, last_sent_date) VALUES (?, ?)
       ON CONFLICT(slot) DO UPDATE SET last_sent_date = ?`
    ).bind(slot.name, dateStr, dateStr).run();
  }
}

async function sendDigest(env: Env, greeting: string, rolledIds: Set<number>, dateStr?: string): Promise<void> {
  const chatId = parseInt(env.ALLOWED_USER_ID, 10);
  if (!chatId) return;

  const { results } = await env.DB.prepare(
    `SELECT * FROM items WHERE status IN ('active', 'notified') ORDER BY type, created_at DESC`
  ).all<Item>();

  let calendarSection = '';
  if (dateStr && env.GOOGLE_CALENDAR_ICS_URL) {
    try {
      calendarSection = await getTodayCalendar(env.GOOGLE_CALENDAR_ICS_URL, dateStr);
    } catch {
      console.warn('Morning calendar fetch failed');
      calendarSection = '📅 今日行程暫時無法讀取';
    }
  }
  if (!results.length) {
    const message = `${greeting}\n\n沒有進行中的事項 🎉`;
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, calendarSection ? message + '\n\n' + calendarSection : message);
    return;
  }

  const grouped: Record<string, Item[]> = {};
  for (const item of results) {
    (grouped[item.type] ??= []).push(item);
  }

  const typeOrder = ['goal', 'task', 'reminder', 'idea', 'inbox'];
  const sortedEntries = Object.entries(grouped).sort(
    (a, b) => typeOrder.indexOf(a[0]) - typeOrder.indexOf(b[0])
  );

  const sections = sortedEntries.map(([type, items]) => {
    const emoji = TYPE_EMOJI[type] || '📄';
    const lines = items.map(i => {
      let line = `  ${emoji} ${i.title || '(無標題)'}`;
      if (rolledIds.has(i.id)) {
        line += ` ↪️ 之前沒完成，排入今天 ${formatTaipei((i.remind_at ?? i.due_at)!).slice(6)}`;
      }
      if (i.status === 'notified') {
        line += ' ⏳ 還沒完成';
      }
      if (type === 'goal' && i.due_at) {
        const days = daysRemaining(i.due_at);
        if (days < 0) {
          line += ` ⚠️ 已逾期 ${Math.abs(days)} 天`;
        } else if (days === 0) {
          line += ` 🔥 今天到期`;
        } else {
          line += ` ⏳ 剩 ${days} 天`;
        }
      }
      return line;
    });
    return lines.join('\n');
  });

  const msg = `${greeting}\n\n${sections.join('\n\n')}\n\n共 ${results.length} 項`;
  if (calendarSection && msg.length + calendarSection.length + 2 <= 3900) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg + '\n\n' + calendarSection);
  } else {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg);
    if (calendarSection) await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, calendarSection);
  }

  // 統整訊息之後，逐項各發一則附按鈕，讓每一項都能直接處理。
  // Workers 單次執行對外請求有上限（免費版 50），超過的項目只提示數量。
  let sent = 0;
  for (const [type, items] of sortedEntries) {
    const emoji = TYPE_EMOJI[type] || '📄';
    for (const i of items) {
      if (sent >= MAX_ITEM_MESSAGES) break;
      sent++;
      const at = i.remind_at ?? i.due_at;
      const text = `${emoji} #${i.id} ${i.title || '(無標題)'}${at ? `
🕒 ${formatTaipei(at)}` : ''}`;
      // 不需要延期按鈕：沒按完成就當作沒完成，隔天早上會自動排入
      await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, text, [[
        { text: '✅ 完成', callback_data: `done:${i.id}` },
        { text: '🗑 刪除', callback_data: `delete:${i.id}` },
      ]]);
    }
  }
  if (results.length > sent) {
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      `還有 ${results.length - sent} 項沒附按鈕，用 /all 查看，或 /done <編號>、/remove <編號> 處理`
    );
  }
}

function daysRemaining(dueAt: string): number {
  const now = new Date();
  const due = new Date(dueAt);
  const diffMs = due.getTime() - now.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

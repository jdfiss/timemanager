import { Env, Item } from './types';
import { sendMessage } from './telegram';
import { completeItem } from './reminder';

const TYPE_EMOJI: Record<string, string> = {
  task: '✅',
  goal: '🎯',
  idea: '💡',
  reminder: '🔔',
  inbox: '📥',
};

export async function handleCommand(
  env: Env,
  chatId: number,
  text: string
): Promise<void> {
  const [cmd, ...args] = text.split(' ');
  const arg = args.join(' ').trim();

  switch (cmd) {
    case '/start':
      return start(env, chatId);
    case '/today':
      return today(env, chatId);
    case '/all':
      return listAll(env, chatId);
    case '/tasks':
      return listByType(env, chatId, 'task');
    case '/ideas':
      return listByType(env, chatId, 'idea');
    case '/goals':
      return listByType(env, chatId, 'goal');
    case '/inbox':
      return listByType(env, chatId, 'inbox');
    case '/reminders':
      return listByType(env, chatId, 'reminder');
    case '/done':
      return markDone(env, chatId, arg);
    case '/remove':
      return remove(env, chatId, arg);
    case '/clearall':
      return clearAll(env, chatId);
    case '/search':
      return search(env, chatId, arg);
    case '/rules':
      return rules(env, chatId);
    case '/help':
      return help(env, chatId);
    default:
      return sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, '未知指令。輸入 /help 查看可用指令。');
  }
}

async function start(env: Env, chatId: number): Promise<void> {
  const msg = [
    '🧠 *Personal Agent 已啟動*',
    '',
    '直接傳訊息給我，我會自動分類保存。',
    '',
    '輸入 /help 查看所有指令。',
  ].join('\n');
  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg);
}

async function help(env: Env, chatId: number): Promise<void> {
  const msg = [
    '📋 *可用指令*',
    '',
    '/today — 今天記錄的所有項目',
    '/all — 所有進行中事項（附操作按鈕）',
    '/tasks — 進行中的任務',
    '/goals — 長期目標',
    '/ideas — 所有點子',
    '/inbox — 未分類項目',
    '/reminders — 待觸發提醒',
    '/done <編號> — 標記完成（支援多個：/done 1 2 3）',
    '/remove <編號> — 刪除項目（支援多個：/remove 1,2,3）',
    '/clearall — 一鍵清除所有進行中項目',
    '/search <關鍵字> — 搜尋',
    '/rules — 查看分類規則',
    '/help — 顯示此訊息',
    '',
    '⏰ 時間到了會跳出「完成／延期一天／刪除」按鈕，不會默默消失。',
    '🔁 說「每天早上8點提醒我吃藥，共10次」這種也可以，會自動重複提醒。',
  ].join('\n');
  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg);
}

async function rules(env: Env, chatId: number): Promise<void> {
  const msg = [
    '🧠 *分類規則*',
    '',
    '你傳一句話進來，AI 會自動判斷類型：',
    '',
    '✅ *task* — 需要行動的短期事項',
    '「要做」「去買」「處理」「完成」',
    '',
    '🎯 *goal* — 長期目標、計劃',
    '「目標」「希望」「計劃」「年底前要」「長期」',
    '',
    '🔔 *reminder* — 有時間意圖的事',
    '「明天提醒我」「等等 7 點」「下午三點」「週五前」「待會」',
    '',
    '💡 *idea* — 靈感、想法',
    '「我覺得」「可能可以」「如果」「有個想法」',
    '',
    '📥 *inbox* — 以上都不像',
    '',
    'AI 同時會提取標題、標籤、時間。',
    '分類不是死板 keyword，會理解語意。',
    '信心度不足時會跳出按鈕讓你手動選擇。',
    '',
    '⏰ *模糊時段一律對應固定時刻*（同一個詞每次都推到同一個時間）：',
    '凌晨 01:00／早上 08:00／中午 12:00／下午 15:00／傍晚 18:00／晚上 20:00／睡前 23:00',
    '只講「明天」沒講時段，預設 08:00。有講明確數字時間就照數字算。',
    '',
    '🔁 *重複提醒*：說「每天/每週」+「共N次」或「提醒到我完成為止」，例如：',
    '「每天早上8點提醒我吃藥，共10次」「每週一晚上提醒倒垃圾，提醒到我完成為止」',
    '',
    '⚠️ *不會讓事項溜走*：時間一到，不論 task/goal/reminder 都會跳出',
    '「✅ 完成／📅 延期一天／🗑 刪除」按鈕，你沒回應它就一直留著（/all、/reminders 等清單都看得到）。',
  ].join('\n');
  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg);
}

async function today(env: Env, chatId: number): Promise<void> {
  const todayStr = new Date().toISOString().slice(0, 10);
  const { results } = await env.DB.prepare(
    `SELECT * FROM items WHERE date(created_at) = ? ORDER BY created_at DESC`
  )
    .bind(todayStr)
    .all<Item>();

  if (!results.length) {
    return sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, '今天還沒有任何記錄。');
  }

  const msg = formatItems('📅 今天的記錄', results);
  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg);
}

async function listByType(env: Env, chatId: number, type: string): Promise<void> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM items WHERE type = ? AND status IN ('active', 'notified') ORDER BY created_at DESC LIMIT 20`
  )
    .bind(type)
    .all<Item>();

  const emoji = TYPE_EMOJI[type] || '📄';
  if (!results.length) {
    return sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `沒有進行中的${type}。`);
  }

  const msg = formatItems(`${emoji} ${type}`, results);
  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg);
}

async function markDone(env: Env, chatId: number, idStr: string): Promise<void> {
  const ids = parseIds(idStr);
  if (ids.length === 0) {
    return sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, '請提供項目編號，例如 /done 3 或 /done 1 2 3');
  }

  const messages: string[] = [];
  const notFound: number[] = [];

  for (const id of ids) {
    const msg = await completeItem(env, id);
    if (msg) messages.push(msg);
    else notFound.push(id);
  }

  const parts: string[] = [...messages];
  if (notFound.length) parts.push(`⚠️ 找不到：${notFound.map(i => `#${i}`).join(' ')}`);
  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, parts.join('\n'));
}

async function remove(env: Env, chatId: number, idStr: string): Promise<void> {
  const ids = parseIds(idStr);
  if (ids.length === 0) {
    return sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, '請提供項目編號，例如 /remove 3 或 /remove 1,2,3');
  }

  const removed: number[] = [];
  const notFound: number[] = [];

  for (const id of ids) {
    const result = await env.DB.prepare(
      `DELETE FROM items WHERE id = ?`
    ).bind(id).run();
    if (result.meta.changes > 0) removed.push(id);
    else notFound.push(id);
  }

  const parts: string[] = [];
  if (removed.length) parts.push(`🗑 已刪除：${removed.map(i => `#${i}`).join(' ')}`);
  if (notFound.length) parts.push(`⚠️ 找不到：${notFound.map(i => `#${i}`).join(' ')}`);
  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, parts.join('\n'));
}

async function clearAll(env: Env, chatId: number): Promise<void> {
  const result = await env.DB.prepare(
    `DELETE FROM items WHERE status IN ('active', 'notified')`
  ).run();

  const count = result.meta.changes ?? 0;
  if (count === 0) {
    return sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, '目前沒有進行中的項目。');
  }
  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `🧹 已清除 ${count} 個進行中項目。`);
}

async function listAll(env: Env, chatId: number): Promise<void> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM items WHERE status IN ('active', 'notified') ORDER BY created_at DESC`
  ).all<Item>();

  if (!results.length) {
    return sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, '目前沒有進行中的項目。');
  }

  for (const item of results) {
    const emoji = TYPE_EMOJI[item.type] || '📄';
    const tags = item.tags ? JSON.parse(item.tags).join(', ') : '';
    const tagStr = tags ? ` [${tags}]` : '';
    const text = `${emoji} #${item.id} ${item.title || '(無標題)'}${tagStr}`;

    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, text, [
      [
        { text: '✅ Done', callback_data: `done:${item.id}` },
        { text: '⏳ Not yet', callback_data: `notyet:${item.id}` },
      ],
    ]);
  }
}

function parseIds(input: string): number[] {
  const ids = input
    .split(/[\s,]+/)
    .map(s => parseInt(s, 10))
    .filter(n => !isNaN(n));
  return [...new Set(ids)];
}

async function search(env: Env, chatId: number, keyword: string): Promise<void> {
  if (!keyword) {
    return sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, '請提供搜尋關鍵字，例如 /search 台積電');
  }

  const pattern = `%${keyword}%`;
  const { results } = await env.DB.prepare(
    `SELECT * FROM items WHERE (title LIKE ?1 OR content LIKE ?1) AND status != 'done' ORDER BY created_at DESC LIMIT 20`
  )
    .bind(pattern)
    .all<Item>();

  if (!results.length) {
    return sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `找不到包含「${keyword}」的項目。`);
  }

  const msg = formatItems(`🔍 搜尋「${keyword}」`, results);
  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg);
}

function formatItems(header: string, items: Item[]): string {
  const lines = items.map((item) => {
    const emoji = TYPE_EMOJI[item.type] || '📄';
    const tags = item.tags ? JSON.parse(item.tags).join(', ') : '';
    const tagStr = tags ? ` [${tags}]` : '';
    return `${emoji} #${item.id} ${item.title || '(無標題)'}${tagStr}`;
  });
  return `*${header}*\n\n${lines.join('\n')}`;
}

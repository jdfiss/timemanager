import { Env, Item } from './types';
import { sendMessage } from './telegram';

const TYPE_EMOJI: Record<string, string> = {
  task: '✅',
  note: '📝',
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
    case '/tasks':
      return listByType(env, chatId, 'task');
    case '/ideas':
      return listByType(env, chatId, 'idea');
    case '/notes':
      return listByType(env, chatId, 'note');
    case '/inbox':
      return listByType(env, chatId, 'inbox');
    case '/reminders':
      return listByType(env, chatId, 'reminder');
    case '/done':
      return markDone(env, chatId, arg);
    case '/remove':
      return remove(env, chatId, arg);
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
    '/tasks — 進行中的任務',
    '/ideas — 所有點子',
    '/notes — 所有筆記',
    '/inbox — 未分類項目',
    '/reminders — 待觸發提醒',
    '/done <編號> — 標記完成',
    '/remove <編號> — 刪除項目',
    '/search <關鍵字> — 搜尋',
    '/rules — 查看分類規則',
    '/help — 顯示此訊息',
  ].join('\n');
  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg);
}

async function rules(env: Env, chatId: number): Promise<void> {
  const msg = [
    '🧠 *分類規則*',
    '',
    '你傳一句話進來，AI 會自動判斷類型：',
    '',
    '✅ *task* — 需要行動的事',
    '「要做」「去買」「處理」「完成」',
    '',
    '🔔 *reminder* — 有時間意圖的事',
    '「明天提醒我」「等等 7 點」「下午三點」「週五前」「待會」',
    '',
    '💡 *idea* — 靈感、想法',
    '「我覺得」「可能可以」「如果」「有個想法」',
    '',
    '📝 *note* — 記錄、筆記',
    '「記一下」「今天學到」「某某說」',
    '',
    '📥 *inbox* — 以上都不像',
    '',
    'AI 同時會提取標題、標籤、時間。',
    '分類不是死板 keyword，會理解語意。',
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
    `SELECT * FROM items WHERE type = ? AND status = 'active' ORDER BY created_at DESC LIMIT 20`
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
  const id = parseInt(idStr, 10);
  if (isNaN(id)) {
    return sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, '請提供項目編號，例如 /done 3');
  }

  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `UPDATE items SET status = 'done', completed_at = ? WHERE id = ? AND status = 'active'`
  )
    .bind(now, id)
    .run();

  if (result.meta.changes === 0) {
    return sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `找不到編號 ${id} 的進行中項目。`);
  }

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `✅ 項目 #${id} 已完成。`);
}

async function remove(env: Env, chatId: number, idStr: string): Promise<void> {
  const id = parseInt(idStr, 10);
  if (isNaN(id)) {
    return sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, '請提供項目編號，例如 /remove 3');
  }

  const result = await env.DB.prepare(
    `DELETE FROM items WHERE id = ?`
  )
    .bind(id)
    .run();

  if (result.meta.changes === 0) {
    return sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `找不到編號 ${id} 的項目。`);
  }

  await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `🗑 項目 #${id} 已刪除。`);
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

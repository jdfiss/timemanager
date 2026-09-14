import { Env, Item } from './types';
import { sendMessage } from './telegram';

export async function checkReminders(env: Env): Promise<void> {
  const now = new Date().toISOString();

  // 1. Fire due reminders
  const { results: due } = await env.DB.prepare(
    `SELECT * FROM items
     WHERE type = 'reminder'
     AND status = 'active'
     AND remind_at IS NOT NULL
     AND remind_at <= ?`
  )
    .bind(now)
    .all<Item>();

  for (const item of due) {
    const chatId = await getChatId(env, item.raw_message_id);
    if (!chatId) continue;

    const msg = `🔔 *提醒*\n\n${item.title || item.content || '(無內容)'}`;
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg, [
      [{ text: '✅ Done', callback_data: `done:${item.id}` }],
    ]);

    await env.DB.prepare(
      `UPDATE items SET status = 'notified', notified_at = ? WHERE id = ?`
    )
      .bind(now, item.id)
      .run();
  }

  // 2. Snooze: notified > 1 hour ago and not done → remind again tomorrow
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { results: snoozed } = await env.DB.prepare(
    `SELECT * FROM items
     WHERE type = 'reminder'
     AND status = 'notified'
     AND notified_at IS NOT NULL
     AND notified_at <= ?`
  )
    .bind(oneHourAgo)
    .all<Item>();

  for (const item of snoozed) {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await env.DB.prepare(
      `UPDATE items SET status = 'active', remind_at = ?, notified_at = NULL WHERE id = ?`
    )
      .bind(tomorrow, item.id)
      .run();
  }
}

async function getChatId(env: Env, rawMessageId: number | null): Promise<number | null> {
  if (!rawMessageId) return parseInt(env.ALLOWED_USER_ID, 10) || null;

  const row = await env.DB.prepare(
    `SELECT user_id FROM raw_messages WHERE id = ?`
  )
    .bind(rawMessageId)
    .first<{ user_id: number }>();

  return row?.user_id ?? parseInt(env.ALLOWED_USER_ID, 10) ?? null;
}

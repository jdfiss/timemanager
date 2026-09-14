import { Env, TelegramUpdate } from './types';
import { verifyWebhookSecret, isAllowedUser } from './auth';
import { sendMessage, answerCallbackQuery, setWebhook } from './telegram';
import { classify } from './classifier';
import { handleCommand } from './commands';
import { checkReminders } from './reminder';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/setup-webhook') {
      const webhookUrl = `${url.origin}/webhook`;
      const res = await setWebhook(env.TELEGRAM_BOT_TOKEN, webhookUrl, env.TELEGRAM_WEBHOOK_SECRET);
      const body = await res.text();
      return new Response(body, { headers: { 'Content-Type': 'application/json' } });
    }

    if (url.pathname !== '/webhook' || request.method !== 'POST') {
      return new Response('ok');
    }

    if (!verifyWebhookSecret(request, env)) {
      return new Response('Unauthorized', { status: 403 });
    }

    const update: TelegramUpdate = await request.json();

    // Handle inline button callback
    if (update.callback_query) {
      const cb = update.callback_query;
      if (cb.from.id.toString() !== env.ALLOWED_USER_ID) {
        return new Response('ok');
      }
      await handleCallback(env, cb.id, cb.data, cb.message?.chat.id);
      return new Response('ok');
    }

    if (!isAllowedUser(update, env)) {
      return new Response('ok');
    }

    const message = update.message;
    if (!message?.text) {
      return new Response('ok');
    }

    const chatId = message.chat.id;
    const text = message.text.trim();

    if (text.startsWith('/')) {
      await handleCommand(env, chatId, text);
      return new Response('ok');
    }

    await processMessage(env, chatId, message.message_id, message.from!.id, text);
    return new Response('ok');
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await checkReminders(env);
    await retryPending(env);
  },
} satisfies ExportedHandler<Env>;

async function handleCallback(
  env: Env,
  callbackId: string,
  data: string | undefined,
  chatId: number | undefined
): Promise<void> {
  if (!data?.startsWith('done:') || !chatId) {
    await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, callbackId);
    return;
  }

  const itemId = parseInt(data.slice(5), 10);
  if (isNaN(itemId)) {
    await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, callbackId, '無效的項目編號');
    return;
  }

  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `UPDATE items SET status = 'done', completed_at = ? WHERE id = ? AND status IN ('active', 'notified')`
  )
    .bind(now, itemId)
    .run();

  if (result.meta.changes === 0) {
    await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, callbackId, '已處理過了');
  } else {
    await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, callbackId, '✅ 已完成！');
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `✅ 項目 #${itemId} 已完成。`);
  }
}

async function processMessage(
  env: Env,
  chatId: number,
  messageId: number,
  userId: number,
  text: string
): Promise<void> {
  const now = new Date().toISOString();

  const rawResult = await env.DB.prepare(
    `INSERT INTO raw_messages (telegram_message_id, user_id, raw_text, created_at, processing_status)
     VALUES (?, ?, ?, ?, 'pending')`
  )
    .bind(messageId, userId, text, now)
    .run();

  const rawId = rawResult.meta.last_row_id;

  try {
    const result = await classify(env, text);

    await env.DB.prepare(
      `INSERT INTO items (raw_message_id, type, title, content, status, due_at, remind_at, tags, confidence, created_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`
    )
      .bind(
        rawId,
        result.type,
        result.title,
        result.content,
        result.due_at,
        result.remind_at,
        JSON.stringify(result.tags),
        result.confidence,
        now
      )
      .run();

    await env.DB.prepare(
      `UPDATE raw_messages SET processing_status = 'done' WHERE id = ?`
    )
      .bind(rawId)
      .run();

    const emoji: Record<string, string> = {
      task: '✅', note: '📝', idea: '💡', reminder: '🔔', inbox: '📥',
    };
    const e = emoji[result.type] || '📄';
    let reply = `${e} 已記錄：${result.title}`;
    if (result.remind_at) {
      reply += `\n⏰ 將在 ${result.remind_at} 提醒你`;
    }

    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, reply);
  } catch (err) {
    console.error('Classification failed:', err);
    await env.DB.prepare(
      `UPDATE raw_messages SET processing_status = 'error' WHERE id = ?`
    )
      .bind(rawId)
      .run();

    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      '📥 已保存原始訊息，但分類暫時失敗，稍後會重試。'
    );
  }
}

async function retryPending(env: Env): Promise<void> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM raw_messages WHERE processing_status = 'error' LIMIT 5`
  ).all<{ id: number; user_id: number; raw_text: string; created_at: string }>();

  for (const row of results) {
    try {
      const result = await classify(env, row.raw_text);
      await env.DB.prepare(
        `INSERT INTO items (raw_message_id, type, title, content, status, due_at, remind_at, tags, confidence, created_at)
         VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`
      )
        .bind(
          row.id,
          result.type,
          result.title,
          result.content,
          result.due_at,
          result.remind_at,
          JSON.stringify(result.tags),
          result.confidence,
          row.created_at
        )
        .run();

      await env.DB.prepare(
        `UPDATE raw_messages SET processing_status = 'done' WHERE id = ?`
      )
        .bind(row.id)
        .run();
    } catch {
      // 下次 cron 再重試
    }
  }
}

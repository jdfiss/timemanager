import { Env, TelegramUpdate, ItemType } from './types';
import { verifyWebhookSecret, isAllowedUser } from './auth';
import { sendMessage, answerCallbackQuery, setWebhook } from './telegram';
import { classify } from './classifier';
import { handleCommand } from './commands';
import { checkReminders, completeItem, postponeItem } from './reminder';
import { checkDigest } from './digest';
import { findSimilarItems, formatSimilarHint } from './similar';
import { formatTaipei } from './timeparse';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/setup-webhook') {
      const webhookUrl = `${url.origin}/webhook`;
      const res = await setWebhook(env.TELEGRAM_BOT_TOKEN, webhookUrl, env.TELEGRAM_WEBHOOK_SECRET);
      const body = await res.text();
      return new Response(body, { headers: { 'Content-Type': 'application/json' } });
    }

    if (url.pathname === '/cron') {
      await checkReminders(env);
      await checkDigest(env);
      return new Response('ok');
    }

    if (url.pathname !== '/webhook' || request.method !== 'POST') {
      return new Response('ok');
    }

    if (!verifyWebhookSecret(request, env)) {
      return new Response('Unauthorized', { status: 403 });
    }

    const update: TelegramUpdate = await request.json();

    ctx.waitUntil(
      Promise.all([
        checkReminders(env),
        checkDigest(env),
      ]).catch(() => {})
    );

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
    await checkDigest(env);
    await retryPending(env);
  },
} satisfies ExportedHandler<Env>;

const CONFIDENCE_THRESHOLD = 0.7;

const TYPE_EMOJI: Record<string, string> = {
  task: '✅', goal: '🎯', idea: '💡', reminder: '🔔', inbox: '📥',
};

const TYPE_LABELS: Record<string, string> = {
  task: '✅ 任務', goal: '🎯 目標', idea: '💡 點子', reminder: '🔔 提醒',
};

async function handleCallback(
  env: Env,
  callbackId: string,
  data: string | undefined,
  chatId: number | undefined
): Promise<void> {
  if (!data || !chatId) {
    await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, callbackId);
    return;
  }

  if (data.startsWith('done:')) {
    const itemId = parseInt(data.slice(5), 10);
    if (isNaN(itemId)) {
      await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, callbackId, '無效的項目編號');
      return;
    }
    const msg = await completeItem(env, itemId);
    if (!msg) {
      await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, callbackId, '已處理過了');
    } else {
      await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, callbackId, '✅ 已完成！');
      await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg);
    }
    return;
  }

  if (data.startsWith('postpone:')) {
    const itemId = parseInt(data.slice(9), 10);
    if (isNaN(itemId)) {
      await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, callbackId, '無效的項目編號');
      return;
    }
    const msg = await postponeItem(env, itemId);
    if (!msg) {
      await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, callbackId, '已處理過了');
    } else {
      await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, callbackId, '📅 已延期');
      await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, msg);
    }
    return;
  }

  if (data.startsWith('delete:')) {
    const itemId = parseInt(data.slice(7), 10);
    if (isNaN(itemId)) {
      await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, callbackId, '無效的項目編號');
      return;
    }
    const result = await env.DB.prepare(`DELETE FROM items WHERE id = ?`).bind(itemId).run();
    if (result.meta.changes === 0) {
      await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, callbackId, '已處理過了');
    } else {
      await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, callbackId, '🗑 已刪除');
      await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `🗑 項目 #${itemId} 已刪除。`);
    }
    return;
  }

  if (data.startsWith('notyet:')) {
    const itemId = parseInt(data.slice(7), 10);
    if (isNaN(itemId)) {
      await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, callbackId, '無效的項目編號');
      return;
    }
    await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, callbackId, '⏳ 繼續加油！');
    return;
  }

  if (data.startsWith('type:')) {
    const parts = data.slice(5).split(':');
    const itemId = parseInt(parts[0], 10);
    const newType = parts[1] as ItemType;
    if (isNaN(itemId) || !['task', 'goal', 'idea', 'reminder', 'inbox'].includes(newType)) {
      await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, callbackId, '無效的選項');
      return;
    }
    const result = await env.DB.prepare(
      `UPDATE items SET type = ? WHERE id = ?`
    ).bind(newType, itemId).run();

    if (result.meta.changes === 0) {
      await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, callbackId, '找不到項目');
    } else {
      const emoji = TYPE_EMOJI[newType] || '📄';
      await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, callbackId, `${emoji} 已分類為 ${newType}`);
      await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, `${emoji} 項目 #${itemId} 已重新分類為 *${newType}*`);
    }
    return;
  }

  await answerCallbackQuery(env.TELEGRAM_BOT_TOKEN, callbackId);
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

    const similar = await findSimilarItems(env, result, text);

    const saveType = result.confidence < CONFIDENCE_THRESHOLD ? 'inbox' : result.type;

    const itemResult = await env.DB.prepare(
      `INSERT INTO items (raw_message_id, type, title, content, status, due_at, remind_at, tags, confidence, created_at, repeat_freq, repeat_remaining, repeat_total)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        rawId,
        saveType,
        result.title,
        result.content,
        result.due_at,
        result.remind_at,
        JSON.stringify(result.tags),
        result.confidence,
        now,
        result.repeat_freq,
        result.repeat_count,
        result.repeat_count
      )
      .run();

    const itemId = itemResult.meta.last_row_id;

    await env.DB.prepare(
      `UPDATE raw_messages SET processing_status = 'done' WHERE id = ?`
    )
      .bind(rawId)
      .run();

    const e = TYPE_EMOJI[saveType] || '📄';
    let reply = `${e} 已記錄：${result.title}`;
    if (result.remind_at) {
      reply += `\n⏰ 將在 ${formatTaipei(result.remind_at)} 提醒你`;
    }
    if (result.repeat_freq) {
      const freqLabel = result.repeat_freq === 'daily' ? '每天' : '每週';
      const countLabel = result.repeat_count !== null ? `，共 ${result.repeat_count} 次` : '，直到你標記完成';
      reply += `\n🔁 ${freqLabel}提醒${countLabel}`;
    }

    if (similar.length > 0) {
      reply += formatSimilarHint(similar);
    }

    if (result.confidence < CONFIDENCE_THRESHOLD) {
      reply += `\n\n🤔 AI 不太確定分類（信心度 ${Math.round(result.confidence * 100)}%），請選擇：`;
      const buttons = Object.entries(TYPE_LABELS).map(([type, label]) => [
        { text: label, callback_data: `type:${itemId}:${type}` },
      ]);
      await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, reply, buttons);
    } else {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, reply);
    }
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
        `INSERT INTO items (raw_message_id, type, title, content, status, due_at, remind_at, tags, confidence, created_at, repeat_freq, repeat_remaining, repeat_total)
         VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)`
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
          row.created_at,
          result.repeat_freq,
          result.repeat_count,
          result.repeat_count
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

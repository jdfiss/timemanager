import { Env, TelegramUpdate } from './types';

export function verifyWebhookSecret(request: Request, env: Env): boolean {
  const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
  return secret === env.TELEGRAM_WEBHOOK_SECRET;
}

export function isAllowedUser(update: TelegramUpdate, env: Env): boolean {
  const userId = update.message?.from?.id;
  if (!userId) return false;
  return userId.toString() === env.ALLOWED_USER_ID;
}

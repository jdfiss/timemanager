import type { TelegramMessage } from './types';

export function shouldIgnoreGroupMessage(message: TelegramMessage, groupChatId?: string): boolean {
  if (message.chat.type !== 'group' && message.chat.type !== 'supergroup') return false;
  if (!groupChatId || message.chat.id.toString() !== groupChatId) return true;

  // Other bots can receive these messages; the primary bot should leave them alone.
  if (message.entities?.some(entity => entity.type === 'mention' || entity.type === 'text_mention')) {
    return true;
  }
  const text = message.text?.trim() ?? '';
  return /(^|\s)@\w+/u.test(text) || /^\/\S+@\w+/u.test(text);
}

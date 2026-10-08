export interface Env {
  DB: D1Database;
  AI: Ai;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  ALLOWED_USER_ID: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramCallbackQuery {
  id: string;
  from: { id: number; first_name: string };
  message?: { chat: { id: number }; message_id: number };
  data?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: { id: number; first_name: string };
  chat: { id: number };
  text?: string;
  date: number;
}

export type ItemType = 'task' | 'goal' | 'idea' | 'reminder' | 'inbox';

export type RepeatFreq = 'daily' | 'weekly';

export interface ClassificationResult {
  type: ItemType;
  title: string;
  content: string;
  remind_at: string | null;
  due_at: string | null;
  tags: string[];
  confidence: number;
  repeat_freq: RepeatFreq | null;
  repeat_count: number | null;
  time_issue: string | null;
}

export interface RawMessage {
  id: number;
  telegram_message_id: number;
  user_id: number;
  raw_text: string;
  created_at: string;
  processing_status: string;
}

export interface Item {
  id: number;
  raw_message_id: number | null;
  type: ItemType;
  title: string;
  content: string | null;
  status: string;
  due_at: string | null;
  remind_at: string | null;
  tags: string | null;
  confidence: number | null;
  created_at: string;
  completed_at: string | null;
  notified_at: string | null;
  repeat_freq: RepeatFreq | null;
  repeat_remaining: number | null;
  repeat_total: number | null;
}

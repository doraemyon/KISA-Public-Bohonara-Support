export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  ADMIN_TELEGRAM_USER_ID: string;
  BOT_USERNAME: string;
  KISA_RSS_URL: string;
  NOTICE_PAGES_BASE_URL: string;
  MAX_SUBSCRIBERS: string;
  BROADCAST_BATCH_SIZE: string;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
}

export interface TelegramUser {
  id: number;
  is_bot?: boolean;
}

export interface TelegramMessage {
  message_id: number;
  text?: string;
  chat: TelegramChat;
  from?: TelegramUser;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export interface Notice {
  id: string;
  title: string;
  link: string;
  published: string;
}

export interface PendingDelivery {
  notice_id: string;
  chat_id: string;
  attempts: number;
  title: string;
  link: string;
  published_at: string;
}

export type InlineKeyboard = Array<Array<{ text: string; url: string }>>;

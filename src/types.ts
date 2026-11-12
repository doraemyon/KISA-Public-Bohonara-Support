export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  ADMIN_TELEGRAM_USER_ID: string;
  APPLICATION_ACCOUNT_PREFIX: string;
  BOT_USERNAME: string;
  KISA_RSS_URL: string;
  NOTICE_PAGES_BASE_URL: string;
  MAX_SUBSCRIBERS: string;
  BROADCAST_BATCH_SIZE: string;
  MAX_PENDING_APPLICATIONS: string;
  MAX_APPLICATIONS_PER_HOUR: string;
  ADMIN_NOTIFICATION_BATCH_SIZE: string;
}

export interface TelegramChat {
  id: number;
  type: "private" | "group" | "supergroup" | "channel";
}

export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
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
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
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

export interface PendingApplication {
  chat_id: string;
  display_name: string;
  username: string | null;
  solution_account: string;
  requested_at: string;
  notify_attempts: number;
}

export interface InlineKeyboardButton {
  text: string;
  url?: string;
  callback_data?: string;
}

export type InlineKeyboard = InlineKeyboardButton[][];

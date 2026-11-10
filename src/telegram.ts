import type { Env, InlineKeyboard } from "./types";

export class TelegramApiError extends Error {
  constructor(
    readonly status: number,
    readonly description: string,
  ) {
    super(`Telegram API returned ${status}: ${description}`);
  }
}

async function callTelegram<T>(
  env: Env,
  method: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
    },
  );
  let body: { ok?: boolean; description?: string; result?: T } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    throw new TelegramApiError(response.status, "invalid JSON response");
  }
  if (!response.ok || body.ok !== true) {
    throw new TelegramApiError(
      response.status,
      body.description?.slice(0, 300) ?? "request rejected",
    );
  }
  return body.result as T;
}

export async function sendTelegramMessage(
  env: Env,
  chatId: string,
  message: string,
  keyboard?: InlineKeyboard,
): Promise<number> {
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text: message,
    disable_notification: false,
    link_preview_options: { is_disabled: true },
  };
  if (keyboard) {
    payload.reply_markup = { inline_keyboard: keyboard };
  }

  const result = await callTelegram<{ message_id?: number }>(env, "sendMessage", payload);
  if (!Number.isInteger(result?.message_id)) {
    throw new TelegramApiError(502, "sendMessage returned no message_id");
  }
  return result.message_id as number;
}

export async function answerTelegramCallback(
  env: Env,
  callbackQueryId: string,
  text: string,
): Promise<void> {
  await callTelegram<boolean>(env, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
    show_alert: false,
  });
}

export async function editTelegramMessage(
  env: Env,
  chatId: string,
  messageId: number,
  message: string,
): Promise<void> {
  await callTelegram(env, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: message,
    link_preview_options: { is_disabled: true },
  });
}

export function isPermanentRecipientError(error: unknown): boolean {
  if (!(error instanceof TelegramApiError)) return false;
  const description = error.description.toLowerCase();
  return (
    error.status === 403 ||
    description.includes("chat not found") ||
    description.includes("user is deactivated") ||
    description.includes("bot was blocked")
  );
}

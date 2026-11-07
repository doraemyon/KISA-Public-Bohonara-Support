import type { Env, InlineKeyboard } from "./types";

export class TelegramApiError extends Error {
  constructor(
    readonly status: number,
    readonly description: string,
  ) {
    super(`Telegram API returned ${status}: ${description}`);
  }
}

export async function sendTelegramMessage(
  env: Env,
  chatId: string,
  message: string,
  keyboard?: InlineKeyboard,
): Promise<void> {
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text: message,
    disable_notification: false,
    link_preview_options: { is_disabled: true },
  };
  if (keyboard) {
    payload.reply_markup = { inline_keyboard: keyboard };
  }

  const response = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
    },
  );
  let result: { ok?: boolean; description?: string } = {};
  try {
    result = (await response.json()) as typeof result;
  } catch {
    throw new TelegramApiError(response.status, "invalid JSON response");
  }
  if (!response.ok || result.ok !== true) {
    throw new TelegramApiError(
      response.status,
      result.description?.slice(0, 300) ?? "request rejected",
    );
  }
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

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
if (!token) throw new Error("Set TELEGRAM_BOT_TOKEN in the current shell first.");

const response = await fetch(
  `https://api.telegram.org/bot${token}/getUpdates?limit=100&timeout=0`,
);
const result = await response.json();
if (!response.ok || result.ok !== true) {
  throw new Error(
    `Telegram rejected getUpdates: ${result.description ?? `HTTP ${response.status}`}`,
  );
}

const messages = result.result
  .map((update) => update.message)
  .filter((message) => message?.chat?.type === "private" && message?.from?.id);
const latest = messages.at(-1);
if (!latest) {
  throw new Error(
    "No private message found. Send /start to the new bot before running this script. " +
      "If a webhook is already configured, delete it first.",
  );
}
console.log(`Use this value for ADMIN_TELEGRAM_USER_ID: ${latest.from.id}`);

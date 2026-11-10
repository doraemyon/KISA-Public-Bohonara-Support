function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment value: ${name}`);
  return value;
}

const token = required("TELEGRAM_BOT_TOKEN");
const secretToken = required("TELEGRAM_WEBHOOK_SECRET");
if (!/^[A-Za-z0-9_-]{16,256}$/.test(secretToken)) {
  throw new Error(
    "TELEGRAM_WEBHOOK_SECRET must be 16-256 letters, digits, underscores, or hyphens.",
  );
}
const baseUrl = new URL(required("WORKER_BASE_URL"));
if (baseUrl.protocol !== "https:" || baseUrl.search || baseUrl.hash) {
  throw new Error("WORKER_BASE_URL must be a plain HTTPS URL.");
}
const webhookUrl = new URL("/telegram/webhook", `${baseUrl.toString().replace(/\/$/, "")}/`);

const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({
    url: webhookUrl.toString(),
    secret_token: secretToken,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: false,
  }),
});
const result = await response.json();
if (!response.ok || result.ok !== true) {
  throw new Error(
    `Telegram rejected webhook setup: ${result.description ?? `HTTP ${response.status}`}`,
  );
}
console.log(`Telegram webhook configured at ${webhookUrl}.`);

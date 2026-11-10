import { randomBytes } from "node:crypto";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment value: ${name}`);
  return value;
}

const token = required("TELEGRAM_BOT_TOKEN");

async function telegram(method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: payload ? "POST" : "GET",
    headers: payload ? { "Content-Type": "application/json; charset=utf-8" } : {},
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const result = await response.json();
  if (!response.ok || result.ok !== true) {
    throw new Error(
      `Telegram rejected ${method}: ${result.description ?? `HTTP ${response.status}`}`,
    );
  }
  return result.result;
}

const bot = await telegram("getMe");
if (!bot?.username) throw new Error("Telegram returned no bot username.");

await telegram("setMyCommands", {
  commands: [
    { command: "status", description: "구독 상태 확인" },
    { command: "stop", description: "구독 해제 및 신청 정보 삭제" },
    { command: "help", description: "사용 가능한 명령어 확인" },
  ],
});
await telegram("setMyDescription", {
  description:
    "KISA 보호나라 보안공지를 Telegram 개인 메시지로 전달합니다. 가입 신청 후 관리자 승인이 필요합니다.",
});
await telegram("setMyShortDescription", {
  short_description: "관리자 승인형 KISA 보안공지 알림",
});

let adminId = process.env.ADMIN_TELEGRAM_USER_ID?.trim() ?? "";
if (!adminId) {
  const updates = await telegram("getUpdates?limit=100&timeout=0");
  const messages = updates
    .map((update) => update.message)
    .filter((message) => message?.chat?.type === "private" && message?.from?.id);
  const latest = messages.at(-1);
  if (!latest) {
    throw new Error(
      "No private message found. Send /start to the new bot, then run this script again.",
    );
  }
  adminId = String(latest.from.id);
}
if (!/^\d{1,20}$/.test(adminId)) {
  throw new Error("ADMIN_TELEGRAM_USER_ID must be numeric.");
}

const suppliedSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim() ?? "";
if (suppliedSecret && !/^[A-Za-z0-9_-]{16,256}$/.test(suppliedSecret)) {
  throw new Error(
    "TELEGRAM_WEBHOOK_SECRET must be 16-256 letters, digits, underscores, or hyphens.",
  );
}
const suggestedSecret = suppliedSecret || randomBytes(32).toString("base64url");

console.log("Telegram bot prepared successfully.");
console.log(`BOT_USERNAME=${bot.username}`);
console.log(`ADMIN_TELEGRAM_USER_ID=${adminId}`);
console.log(`TELEGRAM_WEBHOOK_SECRET=${suggestedSecret}`);

const workerBaseUrl = process.env.WORKER_BASE_URL?.trim() ?? "";
if (workerBaseUrl) {
  if (!suppliedSecret) {
    throw new Error(
      "Set TELEGRAM_WEBHOOK_SECRET to the value already stored in Cloudflare before configuring the webhook.",
    );
  }
  const parsed = new URL(workerBaseUrl);
  if (parsed.protocol !== "https:" || parsed.search || parsed.hash) {
    throw new Error("WORKER_BASE_URL must be a plain HTTPS URL.");
  }
  const webhookUrl = new URL(
    "/telegram/webhook",
    `${parsed.toString().replace(/\/$/, "")}/`,
  );
  await telegram("setWebhook", {
    url: webhookUrl.toString(),
    secret_token: suppliedSecret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: false,
  });
  console.log(`Telegram webhook configured at ${webhookUrl}.`);
}

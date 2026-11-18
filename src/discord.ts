import { maxSubscribers } from "./config";
import { discordApi, discordId, discordSignupConfig, openWebhook, removeWebhook, webhookPath } from "./discord-connection";
import { noticeKeyboard } from "./notice-pages";
import { answerTelegramCallback, editTelegramMessage, sendTelegramMessage } from "./telegram";
import type { Env, TelegramCallbackQuery } from "./types";

interface Pending { id: number; applicant_name: string; discord_user_id: string; requested_at: string; }
interface Delivery {
  subscription_id: number; discord_user_id: string; notice_id: string; title: string; link: string;
  published_at: string; attempts: number; sealed_webhook: string; is_test: number;
}

async function sendRequest(env: Env, admin: string, row: Pending): Promise<void> {
  await sendTelegramMessage(env, admin, [
    "[Discord 알림 구독 신청]", "신청 번호: " + row.id, "성명: " + row.applicant_name,
    "Discord 사용자 ID: " + row.discord_user_id, "접수: " + row.requested_at,
  ].join("\n"), [[
    { text: "승인", callback_data: "discord-name:approve:" + row.id },
    { text: "거절", callback_data: "discord-name:reject:" + row.id },
  ]]);
}

export async function handleDiscordAdminCommand(env: Env, chatId: string, name: string, args: string[]): Promise<boolean> {
  if (name === "discordrevoke") {
    const id = Number(args[0]);
    if (!Number.isSafeInteger(id) || id < 1) {
      await sendTelegramMessage(env, chatId, "사용법: /discordrevoke 신청번호");
      return true;
    }
    const row = await env.DB.prepare(
      "DELETE FROM discord_webhook_subscriptions WHERE id = ?1 RETURNING sealed_webhook",
    ).bind(id).first<{ sealed_webhook: string }>();
    if (row) await removeStoredWebhook(env, row.sealed_webhook);
    await sendTelegramMessage(env, chatId, row ? "Discord 연결을 해제했습니다." : "해당 번호의 Discord 연결이 없습니다.");
    return true;
  }
  if (name !== "discordapplications") return false;
  const rows = await env.DB.prepare(
    "SELECT id, applicant_name, discord_user_id, requested_at FROM discord_webhook_subscriptions " +
    "WHERE approved_at IS NULL AND applicant_name IS NOT NULL ORDER BY requested_at LIMIT 5",
  ).all<Pending>();
  if (!rows.results.length) await sendTelegramMessage(env, chatId, "대기 중인 Discord 신청이 없습니다.");
  for (const row of rows.results) await sendRequest(env, chatId, row);
  return true;
}

async function removeStoredWebhook(env: Env, sealed: string): Promise<boolean> {
  if (!env.DISCORD_WEBHOOK_KEY) return false;
  try {
    return await removeWebhook(await openWebhook(sealed, env.DISCORD_WEBHOOK_KEY));
  } catch {
    console.error("Could not decrypt a removed Discord connection.");
    return false;
  }
}

async function cleanupUnfinishedSignups(env: Env, now: string): Promise<void> {
  const expired = await env.DB.prepare(
    "SELECT id, name_state_hash, sealed_webhook FROM discord_webhook_subscriptions " +
    "WHERE approved_at IS NULL AND applicant_name IS NULL AND name_expires_at <= ?1 " +
    "ORDER BY name_expires_at LIMIT 3",
  ).bind(now).all<{ id: number; name_state_hash: string; sealed_webhook: string }>();
  for (const row of expired.results) {
    if (!await removeStoredWebhook(env, row.sealed_webhook)) continue;
    await env.DB.prepare(
      "DELETE FROM discord_webhook_subscriptions " +
      "WHERE id = ?1 AND name_state_hash = ?2 AND approved_at IS NULL AND applicant_name IS NULL",
    ).bind(row.id, row.name_state_hash).run();
  }
}

export async function handleDiscordCallback(env: Env, callback: TelegramCallbackQuery): Promise<boolean> {
  const action = /^(discord|discord-name):(approve|reject):(\d{1,15})$/.exec(callback.data ?? "");
  if (!action) return false;
  const admin = env.ADMIN_TELEGRAM_USER_ID.trim();
  if (!admin || String(callback.from.id) !== admin || String(callback.message?.chat.id) !== admin ||
      callback.message?.chat.type !== "private") return true;
  const id = Number(action[3]);
  const legacyAction = action[1] === "discord";
  let label: string;
  if (legacyAction && action[2] === "approve") {
    await answerTelegramCallback(env, callback.id, "성명 확인이 필요합니다. 신청자에게 QR로 다시 신청해 달라고 안내해 주세요.");
    return true;
  }
  if (action[2] === "reject") {
    const row = await env.DB.prepare(
      "DELETE FROM discord_webhook_subscriptions WHERE id = ?1 AND approved_at IS NULL " +
      (legacyAction ? "AND applicant_name IS NULL " : "AND applicant_name IS NOT NULL ") + "RETURNING sealed_webhook",
    ).bind(id).first<{ sealed_webhook: string }>();
    label = row ? "거절됨" : "이미 처리된 신청";
    await answerTelegramCallback(env, callback.id, label);
    if (row) await removeStoredWebhook(env, row.sealed_webhook);
  } else {
    const result = await env.DB.prepare(
      "UPDATE discord_webhook_subscriptions SET approved_at = ?2, name = NULL, applicant_name = NULL " +
      "WHERE id = ?1 AND approved_at IS NULL AND applicant_name IS NOT NULL " +
      "AND (SELECT COUNT(*) FROM discord_webhook_subscriptions WHERE approved_at IS NOT NULL) < ?3",
    ).bind(id, new Date().toISOString(), maxSubscribers(env)).run();
    if (result.meta.changes !== 1) {
      await answerTelegramCallback(env, callback.id, "이미 처리됐거나 Discord 구독 한도에 도달했습니다.");
      return true;
    }
    label = "승인됨";
    await answerTelegramCallback(env, callback.id, label);
  }
  await editTelegramMessage(env, admin, callback.message.message_id, "[Discord 알림 구독 신청]\n신청 번호: " + id + "\n처리: " + label);
  return true;
}

async function notifyAdmin(env: Env, now: string): Promise<void> {
  const admin = env.ADMIN_TELEGRAM_USER_ID.trim();
  if (!admin) return;
  const rows = await env.DB.prepare(
    "SELECT id, applicant_name, discord_user_id, requested_at FROM discord_webhook_subscriptions " +
    "WHERE approved_at IS NULL AND applicant_name IS NOT NULL AND notified_at IS NULL AND notify_after <= ?1 ORDER BY requested_at LIMIT 3",
  ).bind(now).all<Pending>();
  for (const row of rows.results) {
    const lease = await env.DB.prepare(
      "UPDATE discord_webhook_subscriptions SET notify_after = ?2 " +
      "WHERE id = ?1 AND approved_at IS NULL AND notified_at IS NULL AND notify_after <= ?3",
    ).bind(row.id, new Date(Date.now() + 120_000).toISOString(), now).run();
    if (lease.meta.changes !== 1) continue;
    try {
      await sendRequest(env, admin, row);
      await env.DB.prepare("UPDATE discord_webhook_subscriptions SET notified_at = ?2 WHERE id = ?1")
        .bind(row.id, now).run();
    } catch {
      console.warn("Could not notify the administrator about a Discord application.");
    }
  }
}

export function discordNoticeMessage(
  env: Env,
  notice: Pick<Delivery, "title" | "link" | "published_at" | "discord_user_id">,
  isTest = false,
) {
  const recipient = discordId(notice.discord_user_id) ? notice.discord_user_id : undefined;
  const published = notice.published_at ? { description: "게시: " + notice.published_at } : {};
  const noticeTitle = (isTest ? "[연동 테스트] " : "") + notice.title;
  const buttons = noticeKeyboard(env, notice.link).flatMap((row) =>
    row.flatMap(({ text, url }) => url ? [{ type: 2, style: 5, label: text, url }] : []),
  );
  return {
    username: "보호나라 공지 알리미",
    content: recipient ? "<@" + recipient + ">" : undefined,
    embeds: [{ title: Array.from(noticeTitle).slice(0, 128).join(""), ...published, color: 0x5865f2 }],
    components: [{ type: 1, components: buttons }],
    allowed_mentions: { parse: [], users: recipient ? [recipient] : [] },
  };
}

async function deliver(env: Env, delivery: Delivery, key: string, now: string): Promise<void> {
  const lease = await env.DB.prepare(
    "UPDATE discord_webhook_deliveries SET attempts = attempts + 1, next_attempt_at = ?3 " +
    "WHERE subscription_id = ?1 AND notice_id = ?2 AND attempts = ?4 AND sent_at IS NULL AND next_attempt_at <= ?5",
  ).bind(delivery.subscription_id, delivery.notice_id, new Date(Date.now() + 120_000).toISOString(), delivery.attempts, now).run();
  if (lease.meta.changes !== 1) return;
  let retry = Math.min(3600, 60 * 2 ** Math.min(delivery.attempts, 6));
  try {
    const hook = await openWebhook(delivery.sealed_webhook, key);
    const response = await discordApi(webhookPath(hook) + "?wait=true&with_components=true", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(discordNoticeMessage(env, delivery, delivery.is_test === 1)),
    });
    if (response.status === 429) {
      const body = await response.json<{ retry_after?: number }>().catch(() => null);
      const wait = Number(response.headers.get("Retry-After")) || Number(body?.retry_after);
      if (Number.isFinite(wait) && wait > 0) retry = Math.ceil(wait);
    } else {
      await response.body?.cancel().catch(() => {});
      if (response.ok) {
        await env.DB.prepare(
          "UPDATE discord_webhook_deliveries SET sent_at = ?3 WHERE subscription_id = ?1 AND notice_id = ?2",
        ).bind(delivery.subscription_id, delivery.notice_id, new Date().toISOString()).run();
        return;
      }
      if ([401, 403, 404].includes(response.status)) {
        await env.DB.prepare("DELETE FROM discord_webhook_subscriptions WHERE id = ?1")
          .bind(delivery.subscription_id).run();
        return;
      }
      if (response.status < 500) retry = 3600;
      console.warn("Discord delivery returned HTTP", response.status, delivery.notice_id);
    }
  } catch {
    console.warn("Discord delivery did not complete.", delivery.notice_id);
  }
  await env.DB.prepare(
    "UPDATE discord_webhook_deliveries SET next_attempt_at = ?3 WHERE subscription_id = ?1 AND notice_id = ?2 AND attempts = ?4",
  ).bind(delivery.subscription_id, delivery.notice_id, new Date(Date.now() + retry * 1000).toISOString(), delivery.attempts + 1).run();
}

export async function processDiscordNotices(env: Env): Promise<void> {
  const config = discordSignupConfig(env);
  if (!config) return;
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM discord_signup_states WHERE expires_at <= ?1").bind(now),
    env.DB.prepare(
      "INSERT OR IGNORE INTO discord_webhook_deliveries (subscription_id, notice_id, next_attempt_at) " +
      "SELECT s.id, n.notice_id, n.discovered_at FROM discord_webhook_subscriptions s " +
      "JOIN notices n ON n.discovered_at >= s.approved_at " +
      "WHERE n.discovered_at > (SELECT value FROM bot_state WHERE key = 'rss_initialized')",
    ),
  ]);
  const due = await env.DB.prepare(
    "SELECT d.subscription_id, s.discord_user_id, d.notice_id, n.title, n.link, n.published_at, d.attempts, s.sealed_webhook, d.is_test " +
    "FROM discord_webhook_deliveries d JOIN discord_webhook_subscriptions s ON s.id = d.subscription_id " +
    "JOIN notices n USING (notice_id) WHERE s.approved_at IS NOT NULL AND d.sent_at IS NULL AND d.next_attempt_at <= ?1 " +
    "AND (d.is_test = 1 OR NOT EXISTS (SELECT 1 FROM discord_webhook_deliveries p WHERE p.subscription_id = d.subscription_id " +
    "AND p.sent_at IS NULL AND p.is_test = 0 AND p.notice_id < d.notice_id)) ORDER BY d.is_test DESC, d.next_attempt_at LIMIT 10",
  ).bind(now).all<Delivery>();

  const expiration = new Date(Date.now() - 30 * 86400_000).toISOString();
  const expired = await env.DB.prepare(
    "DELETE FROM discord_webhook_subscriptions WHERE id IN (SELECT id FROM discord_webhook_subscriptions " +
    "WHERE approved_at IS NULL AND name_state_hash IS NULL AND requested_at < ?1 ORDER BY requested_at LIMIT 3) RETURNING sealed_webhook",
  ).bind(expiration).all<{ sealed_webhook: string }>();
  await Promise.all([
    notifyAdmin(env, now),
    cleanupUnfinishedSignups(env, now),
    ...due.results.map((row) => deliver(env, row, config.key, now)),
    ...expired.results.map((row) => removeStoredWebhook(env, row.sealed_webhook)),
  ]);
}

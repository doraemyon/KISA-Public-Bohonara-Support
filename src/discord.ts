import { noticeKeyboard } from "./notice-pages";
import type { Env } from "./types";

interface DiscordDelivery {
  notice_id: string;
  title: string;
  link: string;
  published_at: string;
  attempts: number;
}

type DeliveryResult = { sent: true } | { sent: false; retrySeconds: number; rateLimited?: boolean };

export function discordWebhookEndpoint(value?: string): URL | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.origin !== "https://discord.com" || url.username || url.password || url.search || url.hash ||
        !/^\/api\/(?:v10\/)?webhooks\/\d{17,20}\/[A-Za-z0-9_-]+$/.test(url.pathname)) return null;
    url.searchParams.set("wait", "true");
    url.searchParams.set("with_components", "true");
    return url;
  } catch {
    return null;
  }
}

export function discordNoticeMessage(env: Env, notice: Pick<DiscordDelivery, "title" | "link" | "published_at">) {
  const published = notice.published_at ? { description: "게시: " + notice.published_at } : {};
  const buttons = noticeKeyboard(env, notice.link).flatMap((row) =>
    row.flatMap(({ text, url }) => url ? [{ type: 2, style: 5, label: text, url }] : []),
  );
  return {
    embeds: [{ title: Array.from(notice.title).slice(0, 128).join(""), ...published, color: 0x2563eb }],
    components: [{ type: 1, components: buttons }],
    allowed_mentions: { parse: [] },
  };
}

function safeDelaySeconds(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.max(1, Math.ceil(value)) : 60;
}

export async function deliverDiscordNotice(
  endpoint: URL, env: Env, notice: DiscordDelivery,
): Promise<DeliveryResult> {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(discordNoticeMessage(env, notice)),
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
    });
    if (response.ok) {
      await response.body?.cancel().catch(() => {});
      return { sent: true };
    }
    if (response.status === 429) {
      let wait = Number(response.headers.get("Retry-After"));
      if (!(wait > 0)) {
        const details = await response.json<{ retry_after?: number }>().catch(() => null);
        wait = Number(details?.retry_after);
      } else {
        await response.body?.cancel().catch(() => {});
      }
      return { sent: false, retrySeconds: safeDelaySeconds(wait), rateLimited: true };
    }
    await response.body?.cancel().catch(() => {});
    console.warn("Discord notice delivery returned HTTP", response.status, notice.notice_id);
    if (response.status < 500) return { sent: false, retrySeconds: 3600 };
  } catch {
    // Fetch errors can include the URL, which contains the webhook token.
    console.warn("Discord notice delivery could not reach the endpoint", notice.notice_id);
  }
  return { sent: false, retrySeconds: Math.min(3600, 60 * 2 ** Math.min(notice.attempts, 6)) };
}

export async function processDiscordNotices(env: Env, startedAt: string): Promise<void> {
  const endpoint = discordWebhookEndpoint(env.DISCORD_WEBHOOK_URL);
  if (!endpoint) {
    if (env.DISCORD_WEBHOOK_URL) console.warn("DISCORD_WEBHOOK_URL is not a Discord incoming webhook");
    return;
  }

  // Start at activation. If this is the first RSS run, ignore the initial RSS seed too.
  await env.DB.prepare(
    "INSERT OR IGNORE INTO bot_state (key, value) VALUES ('discord_started_at', ?1)",
  ).bind(startedAt).run();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO discord_deliveries (notice_id, next_attempt_at) " +
    "SELECT n.notice_id, n.discovered_at FROM notices n " +
    "WHERE n.discovered_at >= (SELECT value FROM bot_state WHERE key = 'discord_started_at') " +
    "AND n.discovered_at > (SELECT value FROM bot_state WHERE key = 'rss_initialized')",
  ).run();
  const due = await env.DB.prepare(
    "SELECT d.notice_id, n.title, n.link, n.published_at, d.attempts " +
    "FROM discord_deliveries d JOIN notices n USING (notice_id) " +
    "WHERE d.sent_at IS NULL AND d.next_attempt_at <= ?1 " +
    "AND COALESCE((SELECT value FROM bot_state WHERE key = 'discord_retry_until'), '') <= ?1 " +
    "ORDER BY d.next_attempt_at, d.notice_id LIMIT 3",
  ).bind(new Date().toISOString()).all<DiscordDelivery>();
  for (const notice of due.results) {
    const now = new Date().toISOString();
    // Claim before sending; the lease expires if the Worker is interrupted.
    const claim = await env.DB.prepare(
      "UPDATE discord_deliveries SET attempts = attempts + 1, next_attempt_at = ?1 " +
      "WHERE notice_id = ?2 AND attempts = ?3 AND sent_at IS NULL AND next_attempt_at <= ?4",
    ).bind(new Date(Date.now() + 120_000).toISOString(), notice.notice_id, notice.attempts, now).run();
    if (claim.meta.changes !== 1) continue;
    const result = await deliverDiscordNotice(endpoint, env, notice);
    if (result.sent) {
      await env.DB.prepare("UPDATE discord_deliveries SET sent_at = ?1 WHERE notice_id = ?2")
        .bind(new Date().toISOString(), notice.notice_id).run();
    } else {
      const retryAt = new Date(Date.now() + result.retrySeconds * 1000).toISOString();
      await env.DB.prepare(
        "UPDATE discord_deliveries SET next_attempt_at = ?1 WHERE notice_id = ?2 AND attempts = ?3",
      ).bind(retryAt, notice.notice_id, notice.attempts + 1).run();
      if (result.rateLimited) {
        await env.DB.prepare(
          "INSERT INTO bot_state (key, value) VALUES ('discord_retry_until', ?1) " +
          "ON CONFLICT (key) DO UPDATE SET value = MAX(bot_state.value, excluded.value)",
        ).bind(retryAt).run();
        break;
      }
    }
  }
}

import {
  APPLICATION_COMMAND,
  parseCommand,
  parseInviteRequest,
  randomInviteCode,
  sha256,
} from "./access";
import {
  applicationDecisionLabel,
  decideApplication,
  handleApplicationCallback,
  parseApplicantName,
  pendingApplicationCount,
  processPendingApplicationNotifications,
  reopenApplication,
  sendApplicationInstructions,
  submitApplication,
} from "./applications";
import { broadcastBatchSize, maxSubscribers, publicSiteUrl, required } from "./config";
import { noticeKeyboard, serveNoticePage } from "./notice-pages";
import { renderOnboardingPage } from "./onboarding";
import { parseKisaRss } from "./rss";
import {
  isPermanentRecipientError,
  sendTelegramMessage,
} from "./telegram";
import type {
  Env,
  Notice,
  PendingDelivery,
  TelegramMessage,
  TelegramUpdate,
} from "./types";

const VERSION = "0.2.0";
const MAX_RSS_BYTES = 2_000_000;
const DEFAULT_RSS_URL = "https://www.boho.or.kr/kr/rss.do?bbsId=B0000133";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function htmlResponse(body: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    },
  });
}

async function subscriberExists(env: Env, chatId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT 1 AS found FROM subscribers WHERE chat_id = ?1 LIMIT 1",
  )
    .bind(chatId)
    .first<{ found: number }>();
  return row?.found === 1;
}

async function subscribeWithCode(env: Env, chatId: string, code: string): Promise<void> {
  if (await subscriberExists(env, chatId)) {
    // Repeated /start commands must not become an outbound-message amplifier.
    return;
  }

  const codeHash = await sha256(code);
  const now = new Date().toISOString();
  const claimed = await env.DB.prepare(
    `UPDATE invite_codes
     SET used_count = used_count + 1
     WHERE code_hash = ?1
       AND revoked_at IS NULL
       AND expires_at > ?2
       AND used_count < max_uses`,
  )
    .bind(codeHash, now)
    .run();
  if ((claimed.meta.changes ?? 0) !== 1) {
    // Do not answer unauthorized users. An attacker cannot turn rejected
    // commands into outbound Telegram traffic.
    return;
  }

  const inserted = await env.DB.prepare(
    `INSERT INTO subscribers (chat_id, joined_at)
     SELECT ?1, ?2
     WHERE (SELECT COUNT(*) FROM subscribers) < ?3
     ON CONFLICT(chat_id) DO NOTHING`,
  )
    .bind(chatId, now, maxSubscribers(env))
    .run();
  if ((inserted.meta.changes ?? 0) !== 1) {
    await env.DB.prepare(
      "UPDATE invite_codes SET used_count = MAX(0, used_count - 1) WHERE code_hash = ?1",
    )
      .bind(codeHash)
      .run();
    await sendTelegramMessage(
      env,
      chatId,
      "현재 구독 인원이 가득 찼습니다. 관리자에게 문의해 주세요.",
    );
    return;
  }

  await sendTelegramMessage(
    env,
    chatId,
    "KISA 보안공지 알림 구독이 완료됐습니다.\n\n구독 해제: /stop\n상태 확인: /status",
  );
}

async function createInvite(env: Env, chatId: string, args: string[]): Promise<void> {
  const request = parseInviteRequest(args);
  if (!request) {
    await sendTelegramMessage(
      env,
      chatId,
      "사용법: /invite [사용횟수 1~20] [유효일수 1~30]\n예: /invite 1 7",
    );
    return;
  }

  const code = randomInviteCode();
  const codeHash = await sha256(code);
  const expiresAt = new Date(
    Date.now() + request.validDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  await env.DB.prepare(
    `INSERT INTO invite_codes
      (code_hash, expires_at, max_uses, used_count, created_at, created_by)
     VALUES (?1, ?2, ?3, 0, ?4, ?5)`,
  )
    .bind(
      codeHash,
      expiresAt,
      request.maxUses,
      new Date().toISOString(),
      chatId,
    )
    .run();

  const botUsername = required(env.BOT_USERNAME, "BOT_USERNAME").replace(/^@/, "");
  const link = `https://t.me/${botUsername}?start=${code}`;
  await sendTelegramMessage(
    env,
    chatId,
    `초대 링크가 생성됐습니다.\n\n${link}\n\n사용 가능: ${request.maxUses}회\n만료: ${expiresAt}`,
  );
}

async function handleAdminCommand(
  env: Env,
  chatId: string,
  name: string,
  args: string[],
): Promise<boolean> {
  if (chatId !== required(env.ADMIN_TELEGRAM_USER_ID, "ADMIN_TELEGRAM_USER_ID")) {
    return false;
  }

  if (name === "invite") {
    await createInvite(env, chatId, args);
    return true;
  }
  if (name === "subscribers") {
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM subscribers",
    ).first<{ count: number }>();
    await sendTelegramMessage(
      env,
      chatId,
      `현재 구독자: ${row?.count ?? 0}명 / 최대 ${maxSubscribers(env)}명`,
    );
    return true;
  }
  if (name === "applications") {
    await sendTelegramMessage(
      env,
      chatId,
      `승인 대기 신청: ${await pendingApplicationCount(env)}건`,
    );
    return true;
  }
  if (name === "approve" || name === "reject") {
    const target = args[0] ?? "";
    if (!/^\d{1,20}$/.test(target)) {
      await sendTelegramMessage(env, chatId, `사용법: /${name} TELEGRAM_CHAT_ID`);
      return true;
    }
    const decision = await decideApplication(
      env,
      target,
      name === "approve" ? "approve" : "reject",
    );
    await sendTelegramMessage(
      env,
      chatId,
      `Chat ID ${target}: ${applicationDecisionLabel(decision)}`,
    );
    return true;
  }
  if (name === "reopen") {
    const target = args[0] ?? "";
    if (!/^\d{1,20}$/.test(target)) {
      await sendTelegramMessage(env, chatId, "사용법: /reopen TELEGRAM_CHAT_ID");
      return true;
    }
    const reopened = await reopenApplication(env, target);
    await sendTelegramMessage(
      env,
      chatId,
      reopened
        ? `${target} 사용자가 다시 신청할 수 있습니다.`
        : "삭제할 신청 기록이 없거나 현재 구독 중입니다.",
    );
    return true;
  }
  if (name === "revoke") {
    const target = args[0] ?? "";
    if (!/^\d{1,20}$/.test(target)) {
      await sendTelegramMessage(env, chatId, "사용법: /revoke TELEGRAM_CHAT_ID");
      return true;
    }
    const result = await env.DB.prepare("DELETE FROM subscribers WHERE chat_id = ?1")
      .bind(target)
      .run();
    if ((result.meta.changes ?? 0) > 0) {
      await env.DB.prepare(
        `UPDATE applications
         SET status = 'rejected', decided_at = ?1, decided_by = ?2,
             display_name = '', username = NULL, applicant_name = NULL, solution_account = NULL
         WHERE chat_id = ?3`,
      )
        .bind(new Date().toISOString(), chatId, target)
        .run();
    }
    await sendTelegramMessage(
      env,
      chatId,
      (result.meta.changes ?? 0) > 0
        ? `${target} 구독을 해제했습니다.`
        : "해당 구독자를 찾지 못했습니다.",
    );
    return true;
  }
  return false;
}

async function handleCommand(env: Env, message: TelegramMessage): Promise<void> {
  if (message.chat.type !== "private" || !message.text || !message.from) return;
  const chatId = String(message.chat.id);
  const botUsername = required(env.BOT_USERNAME, "BOT_USERNAME").replace(/^@/, "");
  const command = parseCommand(message.text, botUsername);
  if (!command) return;

  if (await handleAdminCommand(env, chatId, command.name, command.args)) return;

  if (command.name === "start") {
    const code = command.args[0];
    if (!code || code.toLowerCase() === "apply") {
      await sendApplicationInstructions(env, chatId);
      return;
    }
    await subscribeWithCode(env, chatId, code);
    return;
  }

  if (command.name === APPLICATION_COMMAND || command.name === "apply") {
    const applicantName = parseApplicantName(command.args);
    if (applicantName) {
      await submitApplication(env, message, applicantName);
    }
    return;
  }

  if (command.name === "stop") {
    if (!(await subscriberExists(env, chatId))) return;
    const [result] = await env.DB.batch([
      env.DB.prepare("DELETE FROM subscribers WHERE chat_id = ?1").bind(chatId),
      env.DB.prepare("DELETE FROM applications WHERE chat_id = ?1").bind(chatId),
    ]);
    await sendTelegramMessage(
      env,
      chatId,
      (result.meta.changes ?? 0) > 0
        ? "KISA 보안공지 알림 구독을 해제했습니다. 저장된 구독 정보도 삭제했습니다."
        : "현재 구독 중이 아닙니다.",
    );
    return;
  }

  if (command.name === "status") {
    if (await subscriberExists(env, chatId)) {
      await sendTelegramMessage(env, chatId, "현재 KISA 보안공지 알림을 구독 중입니다.");
    }
    return;
  }

  if (command.name === "help") {
    if (await subscriberExists(env, chatId)) {
      await sendTelegramMessage(
        env,
        chatId,
        "사용 가능한 명령어\n/status - 구독 상태 확인\n/stop - 구독 해제 및 신청 정보 삭제",
      );
    }
  }
}

async function handleWebhook(request: Request, env: Env): Promise<Response> {
  const expectedSecret = required(
    env.TELEGRAM_WEBHOOK_SECRET,
    "TELEGRAM_WEBHOOK_SECRET",
  );
  const suppliedSecret = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
  if (suppliedSecret !== expectedSecret) {
    return jsonResponse({ ok: false }, 403);
  }

  try {
    const update = (await request.json()) as TelegramUpdate;
    if (update.callback_query) {
      await handleApplicationCallback(env, update.callback_query);
    } else if (update.message) {
      await handleCommand(env, update.message);
    }
  } catch (error) {
    // Return 200 to avoid Telegram replaying a command that may already have
    // changed subscription state. The user can safely retry the command.
    console.error("Webhook processing failed", error);
  }
  return jsonResponse({ ok: true });
}

async function fetchCurrentNotices(env: Env): Promise<Notice[]> {
  const response = await fetch(env.KISA_RSS_URL?.trim() || DEFAULT_RSS_URL, {
    headers: { "User-Agent": "kisa-team-bot/0.2 (+Cloudflare Workers)" },
  });
  if (!response.ok) throw new Error(`KISA RSS returned HTTP ${response.status}.`);
  const xml = await response.text();
  if (new TextEncoder().encode(xml).byteLength > MAX_RSS_BYTES) {
    throw new Error("KISA RSS exceeded the maximum allowed size.");
  }
  return parseKisaRss(xml);
}

async function seedOrQueueNotices(env: Env, notices: Notice[]): Promise<void> {
  const initialized = await env.DB.prepare(
    "SELECT value FROM bot_state WHERE key = 'rss_initialized'",
  ).first<{ value: string }>();
  const now = new Date().toISOString();

  if (!initialized) {
    const statements = notices.map((notice) =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO notices
          (notice_id, title, link, published_at, discovered_at)
         VALUES (?1, ?2, ?3, ?4, ?5)`,
      ).bind(notice.id, notice.title, notice.link, notice.published, now),
    );
    statements.push(
      env.DB.prepare(
        "INSERT OR IGNORE INTO bot_state (key, value) VALUES ('rss_initialized', ?1)",
      ).bind(now),
    );
    await env.DB.batch(statements);
    console.log(`Seeded ${notices.length} existing notices without broadcasting.`);
    return;
  }

  for (const notice of [...notices].reverse()) {
    const [inserted] = await env.DB.batch([
      env.DB.prepare(
        `INSERT OR IGNORE INTO notices
          (notice_id, title, link, published_at, discovered_at)
         VALUES (?1, ?2, ?3, ?4, ?5)`,
      ).bind(notice.id, notice.title, notice.link, notice.published, now),
      env.DB.prepare(
        `INSERT OR IGNORE INTO deliveries
          (notice_id, chat_id, status, attempts, next_attempt_at)
         SELECT ?1, s.chat_id, 'pending', 0, ?2
         FROM subscribers s
         WHERE EXISTS (
           SELECT 1 FROM notices n
           WHERE n.notice_id = ?1 AND n.discovered_at = ?2
         )`,
      ).bind(notice.id, now),
    ]);
    if ((inserted.meta.changes ?? 0) === 1) {
      console.log(`Queued KISA notice ${notice.id}.`);
    }
  }
}

async function deliverOne(env: Env, delivery: PendingDelivery): Promise<void> {
  const publishedLine = delivery.published_at
    ? `\n게시: ${delivery.published_at}`
    : "";
  const message = `[KISA 보안공지]\n${delivery.title}${publishedLine}`;
  try {
    await sendTelegramMessage(
      env,
      delivery.chat_id,
      message,
      noticeKeyboard(env, delivery.link),
    );
    await env.DB.prepare(
      `UPDATE deliveries
       SET status = 'sent', sent_at = ?1, last_error = NULL
       WHERE notice_id = ?2 AND chat_id = ?3`,
    )
      .bind(new Date().toISOString(), delivery.notice_id, delivery.chat_id)
      .run();
  } catch (error) {
    if (isPermanentRecipientError(error)) {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM subscribers WHERE chat_id = ?1").bind(
          delivery.chat_id,
        ),
        env.DB.prepare(
          `UPDATE deliveries
           SET status = 'skipped', last_error = 'recipient unavailable'
           WHERE chat_id = ?1 AND status = 'pending'`,
        ).bind(delivery.chat_id),
      ]);
      return;
    }

    const nextAttempts = delivery.attempts + 1;
    const retrySeconds = Math.min(3600, 60 * 2 ** Math.min(nextAttempts, 5));
    const nextAttempt = new Date(Date.now() + retrySeconds * 1000).toISOString();
    await env.DB.prepare(
      `UPDATE deliveries
       SET attempts = ?1, next_attempt_at = ?2, last_error = ?3
       WHERE notice_id = ?4 AND chat_id = ?5`,
    )
      .bind(
        nextAttempts,
        nextAttempt,
        error instanceof Error ? error.message.slice(0, 300) : "unknown error",
        delivery.notice_id,
        delivery.chat_id,
      )
      .run();
  }
}

async function processPendingDeliveries(env: Env): Promise<void> {
  const result = await env.DB.prepare(
    `SELECT d.notice_id, d.chat_id, d.attempts,
            n.title, n.link, n.published_at
     FROM deliveries d
     JOIN notices n ON n.notice_id = d.notice_id
     WHERE d.status = 'pending' AND d.next_attempt_at <= ?1
     ORDER BY n.discovered_at, d.chat_id
     LIMIT ?2`,
  )
    .bind(new Date().toISOString(), broadcastBatchSize(env))
    .all<PendingDelivery>();
  await Promise.all(result.results.map((delivery) => deliverOne(env, delivery)));
}

async function cleanupExpiredData(env: Env): Promise<void> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM invite_codes WHERE expires_at < ?1 OR revoked_at < ?1",
    ).bind(thirtyDaysAgo),
    env.DB.prepare(
      "DELETE FROM deliveries WHERE status IN ('sent', 'skipped') AND sent_at < ?1",
    ).bind(thirtyDaysAgo),
    env.DB.prepare(
      "DELETE FROM applications WHERE status = 'pending' AND requested_at < ?1",
    ).bind(thirtyDaysAgo),
    env.DB.prepare(
      "DELETE FROM application_prompts WHERE prompted_at < ?1",
    ).bind(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
  ]);
}

async function runScheduled(env: Env): Promise<void> {
  required(env.TELEGRAM_BOT_TOKEN, "TELEGRAM_BOT_TOKEN");
  try {
    const notices = await fetchCurrentNotices(env);
    await seedOrQueueNotices(env, notices);
  } catch (error) {
    console.error("KISA RSS synchronization failed", error);
  }
  await processPendingApplicationNotifications(env);
  await processPendingDeliveries(env);
  await cleanupExpiredData(env);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      return htmlResponse(renderOnboardingPage(env));
    }
    if (request.method === "GET" && url.pathname === "/healthz") {
      return jsonResponse({ ok: true, version: VERSION });
    }
    if (request.method === "POST" && url.pathname === "/telegram/webhook") {
      return handleWebhook(request, env);
    }
    if (request.method === "GET") {
      if (url.pathname === "/robots.txt" || url.pathname === "/sitemap.xml") {
        const site = publicSiteUrl(env);
        if (!site) return jsonResponse({ ok: false, error: "public site URL unavailable" }, 503);
        if (url.pathname === "/robots.txt") {
          return new Response(`User-agent: *\nAllow: /\nSitemap: ${site.origin}/sitemap.xml\n`, {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }
        return new Response(
          `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${site.href}</loc></url>\n</urlset>\n`,
          { headers: { "Content-Type": "application/xml; charset=utf-8" } },
        );
      }
      const noticePage = await serveNoticePage(url, env);
      if (noticePage) return noticePage;
    }
    return jsonResponse({ ok: false, error: "not found" }, 404);
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduled(env));
  },
} satisfies ExportedHandler<Env>;

import {
  adminNotificationBatchSize,
  maxApplicationsPerHour,
  maxPendingApplications,
  maxSubscribers,
  required,
} from "./config";
import {
  answerTelegramCallback,
  editTelegramMessage,
  isPermanentRecipientError,
  sendTelegramMessage,
} from "./telegram";
import type {
  Env,
  PendingApplication,
  TelegramCallbackQuery,
  TelegramMessage,
  TelegramUser,
} from "./types";

export type ApplicationAction = "approve" | "reject";
export type ApplicationDecision =
  | "approved"
  | "rejected"
  | "full"
  | "not-found"
  | "already-processed"
  | "unavailable";

function profileName(user: TelegramUser): string {
  const value = [user.first_name, user.last_name]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return (value || `Telegram 사용자 ${user.id}`).slice(0, 120);
}

function profileUsername(user: TelegramUser): string | null {
  const value = user.username?.trim() ?? "";
  return /^[A-Za-z0-9_]{1,32}$/.test(value) ? value : null;
}

export function parseApplicationCallback(
  value: string | undefined,
): { action: ApplicationAction; chatId: string } | null {
  const match = /^application:(approve|reject):(\d{1,20})$/.exec(value ?? "");
  if (!match) return null;
  return { action: match[1] as ApplicationAction, chatId: match[2] };
}

export async function submitApplication(env: Env, message: TelegramMessage): Promise<boolean> {
  if (message.chat.type !== "private" || !message.from) return false;
  const chatId = String(message.chat.id);
  const now = new Date();
  const nowIso = now.toISOString();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const result = await env.DB.prepare(
    `INSERT INTO applications
      (chat_id, display_name, username, status, requested_at, next_notify_at)
     SELECT ?1, ?2, ?3, 'pending', ?4, ?4
     WHERE NOT EXISTS (SELECT 1 FROM subscribers WHERE chat_id = ?1)
       AND (SELECT COUNT(*) FROM applications WHERE status = 'pending') < ?5
       AND (SELECT COUNT(*) FROM applications WHERE requested_at >= ?6) < ?7
     ON CONFLICT(chat_id) DO NOTHING`,
  )
    .bind(
      chatId,
      profileName(message.from),
      profileUsername(message.from),
      nowIso,
      maxPendingApplications(env),
      oneHourAgo,
      maxApplicationsPerHour(env),
    )
    .run();
  return (result.meta.changes ?? 0) === 1;
}

function adminApplicationMessage(application: PendingApplication): string {
  const username = application.username ? `@${application.username}` : "없음";
  return [
    "[KISA 알림 봇 가입 신청]",
    `표시 이름: ${application.display_name}`,
    `Telegram 사용자명: ${username}`,
    `Chat ID: ${application.chat_id}`,
    `신청 시각: ${application.requested_at}`,
  ].join("\n");
}

async function notifyAdmin(env: Env, application: PendingApplication): Promise<void> {
  const adminId = required(env.ADMIN_TELEGRAM_USER_ID, "ADMIN_TELEGRAM_USER_ID");
  await sendTelegramMessage(env, adminId, adminApplicationMessage(application), [
    [
      {
        text: "승인",
        callback_data: `application:approve:${application.chat_id}`,
      },
      {
        text: "거절",
        callback_data: `application:reject:${application.chat_id}`,
      },
    ],
  ]);
}

export async function processPendingApplicationNotifications(env: Env): Promise<void> {
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `SELECT chat_id, display_name, username, requested_at, notify_attempts
     FROM applications
     WHERE status = 'pending'
       AND admin_notified_at IS NULL
       AND next_notify_at <= ?1
     ORDER BY requested_at
     LIMIT ?2`,
  )
    .bind(now, adminNotificationBatchSize(env))
    .all<PendingApplication>();

  for (const application of result.results) {
    try {
      await notifyAdmin(env, application);
      await env.DB.prepare(
        `UPDATE applications
         SET admin_notified_at = ?1, last_error = NULL
         WHERE chat_id = ?2 AND status = 'pending'`,
      )
        .bind(new Date().toISOString(), application.chat_id)
        .run();
    } catch (error) {
      const attempts = application.notify_attempts + 1;
      const retrySeconds = Math.min(3600, 60 * 2 ** Math.min(attempts, 5));
      await env.DB.prepare(
        `UPDATE applications
         SET notify_attempts = ?1, next_notify_at = ?2, last_error = ?3
         WHERE chat_id = ?4 AND status = 'pending'`,
      )
        .bind(
          attempts,
          new Date(Date.now() + retrySeconds * 1000).toISOString(),
          error instanceof Error ? error.message.slice(0, 300) : "unknown error",
          application.chat_id,
        )
        .run();
    }
  }
}

async function notifyApplicant(
  env: Env,
  chatId: string,
  action: ApplicationAction,
): Promise<"ok" | "unavailable"> {
  const text =
    action === "approve"
      ? "KISA 보안공지 알림 가입이 승인됐습니다.\n\n상태 확인: /status\n구독 해제: /stop"
      : "KISA 보안공지 알림 가입 신청이 승인되지 않았습니다.";
  try {
    await sendTelegramMessage(env, chatId, text);
    return "ok";
  } catch (error) {
    if (isPermanentRecipientError(error)) return "unavailable";
    console.error("Could not send application decision", error);
    return "ok";
  }
}

export async function decideApplication(
  env: Env,
  chatId: string,
  action: ApplicationAction,
): Promise<ApplicationDecision> {
  const adminId = required(env.ADMIN_TELEGRAM_USER_ID, "ADMIN_TELEGRAM_USER_ID");
  const now = new Date().toISOString();

  if (action === "reject") {
    const result = await env.DB.prepare(
      `UPDATE applications
       SET status = 'rejected', decided_at = ?1, decided_by = ?2,
           display_name = '', username = NULL, last_error = NULL
       WHERE chat_id = ?3 AND status = 'pending'`,
    )
      .bind(now, adminId, chatId)
      .run();
    if ((result.meta.changes ?? 0) !== 1) {
      const existing = await env.DB.prepare(
        "SELECT status FROM applications WHERE chat_id = ?1",
      )
        .bind(chatId)
        .first<{ status: string }>();
      return existing ? "already-processed" : "not-found";
    }
    const notified = await notifyApplicant(env, chatId, action);
    return notified === "unavailable" ? "unavailable" : "rejected";
  }

  const [decision] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE applications
       SET status = 'approved', decided_at = ?1, decided_by = ?2,
           display_name = '', username = NULL, last_error = NULL
       WHERE chat_id = ?3
         AND status = 'pending'
         AND (SELECT COUNT(*) FROM subscribers) < ?4`,
    ).bind(now, adminId, chatId, maxSubscribers(env)),
    env.DB.prepare(
      `INSERT INTO subscribers (chat_id, joined_at)
       SELECT chat_id, ?1 FROM applications
       WHERE chat_id = ?2 AND status = 'approved' AND decided_at = ?1
       ON CONFLICT(chat_id) DO NOTHING`,
    ).bind(now, chatId),
  ]);
  if ((decision.meta.changes ?? 0) !== 1) {
    const existing = await env.DB.prepare(
      "SELECT status FROM applications WHERE chat_id = ?1",
    )
      .bind(chatId)
      .first<{ status: string }>();
    if (!existing) return "not-found";
    return existing.status === "pending" ? "full" : "already-processed";
  }

  const notified = await notifyApplicant(env, chatId, action);
  if (notified === "unavailable") {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM subscribers WHERE chat_id = ?1").bind(chatId),
      env.DB.prepare(
        `UPDATE applications
         SET status = 'rejected', decided_at = ?1, last_error = 'recipient unavailable'
         WHERE chat_id = ?2`,
      ).bind(new Date().toISOString(), chatId),
    ]);
    return "unavailable";
  }
  return "approved";
}

export function applicationDecisionLabel(decision: ApplicationDecision): string {
  const labels: Record<ApplicationDecision, string> = {
    approved: "승인 완료",
    rejected: "거절 완료",
    full: "구독 인원 초과",
    "not-found": "신청 없음",
    "already-processed": "이미 처리됨",
    unavailable: "사용자에게 전송할 수 없음",
  };
  return labels[decision];
}

export async function handleApplicationCallback(
  env: Env,
  callback: TelegramCallbackQuery,
): Promise<boolean> {
  const parsed = parseApplicationCallback(callback.data);
  if (!parsed) return false;
  const adminId = required(env.ADMIN_TELEGRAM_USER_ID, "ADMIN_TELEGRAM_USER_ID");
  if (String(callback.from.id) !== adminId) return true;
  if (!callback.message || callback.message.chat.type !== "private") return true;

  const decision = await decideApplication(env, parsed.chatId, parsed.action);
  await answerTelegramCallback(env, callback.id, applicationDecisionLabel(decision));
  if (decision === "approved" || decision === "rejected" || decision === "unavailable") {
    await editTelegramMessage(
      env,
      String(callback.message.chat.id),
      callback.message.message_id,
      `[KISA 알림 봇 가입 신청]\nChat ID: ${parsed.chatId}\n처리 결과: ${applicationDecisionLabel(decision)}`,
    );
  }
  return true;
}

export async function pendingApplicationCount(env: Env): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM applications WHERE status = 'pending'",
  ).first<{ count: number }>();
  return row?.count ?? 0;
}

export async function reopenApplication(env: Env, chatId: string): Promise<boolean> {
  const result = await env.DB.prepare(
    `DELETE FROM applications
     WHERE chat_id = ?1
       AND NOT EXISTS (SELECT 1 FROM subscribers WHERE chat_id = ?1)`,
  )
    .bind(chatId)
    .run();
  return (result.meta.changes ?? 0) === 1;
}

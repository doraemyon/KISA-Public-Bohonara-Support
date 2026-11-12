import { APPLICATION_COMMAND } from "./access";
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
  | "account-required"
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
  const match = /^application:account:(approve|reject):(\d{1,20})$/.exec(value ?? "");
  if (!match) return null;
  return { action: match[1] as ApplicationAction, chatId: match[2] };
}

export function parseSolutionAccount(args: string[], configuredPrefix: string): string | null {
  const prefix = required(configuredPrefix, "APPLICATION_ACCOUNT_PREFIX").toLowerCase();
  if (!/^[a-z]{2}$/.test(prefix)) {
    throw new Error("APPLICATION_ACCOUNT_PREFIX must contain two ASCII letters.");
  }
  if (args.length !== 1) return null;
  const account = args[0];
  const match = /^([A-Za-z]{2})_[0-9]{5}$/.exec(account);
  return match?.[1].toLowerCase() === prefix ? account.toLowerCase() : null;
}

export async function sendApplicationInstructions(env: Env, chatId: string): Promise<void> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - 60_000).toISOString();
  const result = await env.DB.prepare(
    `INSERT INTO application_prompts (chat_id, prompted_at)
     SELECT ?1, ?2
     WHERE NOT EXISTS (SELECT 1 FROM subscribers WHERE chat_id = ?1)
       AND NOT EXISTS (
         SELECT 1 FROM applications
         WHERE chat_id = ?1 AND (status <> 'pending' OR solution_account IS NOT NULL)
       )
       AND (SELECT COUNT(*) FROM application_prompts WHERE prompted_at > ?3) < 5
     ON CONFLICT(chat_id) DO UPDATE SET prompted_at = excluded.prompted_at
     WHERE application_prompts.prompted_at <= ?3`,
  ).bind(chatId, now.toISOString(), cutoff).run();
  if ((result.meta.changes ?? 0) !== 1) return;

  await sendTelegramMessage(
    env,
    chatId,
    "가입 자격 확인을 위해 사내 솔루션 계정명을 입력해 주세요.\n\n" +
      `입력 방법: /${APPLICATION_COMMAND} 뒤에 공백을 한 칸 넣고 실제 계정명을 입력합니다.\n` +
      "계정 형식: 영문 2자_숫자 5자리\n" +
      "비밀번호나 인증코드는 보내지 마세요. 신청은 관리자 확인 후 승인됩니다.",
  );
}

export async function submitApplication(
  env: Env,
  message: TelegramMessage,
  account: string,
): Promise<boolean> {
  if (message.chat.type !== "private" || !message.from) return false;
  const chatId = String(message.chat.id);
  const now = new Date();
  const nowIso = now.toISOString();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const result = await env.DB.prepare(
    `INSERT INTO applications
      (chat_id, display_name, username, status, requested_at, next_notify_at, solution_account)
     SELECT ?1, ?2, ?3, 'pending', ?4, ?4, ?5
     WHERE NOT EXISTS (SELECT 1 FROM subscribers WHERE chat_id = ?1)
       AND (
         SELECT COUNT(*) FROM applications WHERE status = 'pending' AND solution_account IS NOT NULL
       ) < ?6
       AND (
         SELECT COUNT(*) FROM applications
         WHERE requested_at >= ?7 AND (solution_account IS NOT NULL OR status <> 'pending')
       ) < ?8
     ON CONFLICT(chat_id) DO UPDATE SET
       display_name = excluded.display_name,
       username = excluded.username,
       requested_at = excluded.requested_at,
       next_notify_at = excluded.next_notify_at,
       solution_account = excluded.solution_account,
       admin_notified_at = NULL,
       notify_attempts = 0,
       last_error = NULL
     WHERE applications.status = 'pending' AND applications.solution_account IS NULL`,
  )
    .bind(
      chatId,
      profileName(message.from),
      profileUsername(message.from),
      nowIso,
      account,
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
    `사내 솔루션 계정명: ${application.solution_account}`,
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
        callback_data: `application:account:approve:${application.chat_id}`,
      },
      {
        text: "거절",
        callback_data: `application:account:reject:${application.chat_id}`,
      },
    ],
  ]);
}

export async function processPendingApplicationNotifications(env: Env): Promise<void> {
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `SELECT chat_id, display_name, username, solution_account, requested_at, notify_attempts
     FROM applications
     WHERE status = 'pending'
       AND solution_account IS NOT NULL
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
           display_name = '', username = NULL, solution_account = NULL, last_error = NULL
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
           display_name = '', username = NULL, solution_account = NULL, last_error = NULL
       WHERE chat_id = ?3
         AND status = 'pending'
         AND solution_account IS NOT NULL
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
      "SELECT status, solution_account IS NOT NULL AS has_account FROM applications WHERE chat_id = ?1",
    )
      .bind(chatId)
      .first<{ status: string; has_account: number }>();
    if (!existing) return "not-found";
    if (existing.status !== "pending") return "already-processed";
    return existing.has_account ? "full" : "account-required";
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
    "account-required": "사내 솔루션 계정명 입력 필요",
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
    "SELECT COUNT(*) AS count FROM applications WHERE status = 'pending' AND solution_account IS NOT NULL",
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

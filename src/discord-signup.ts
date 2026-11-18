import { sha256 } from "./access";
import { parseApplicantName } from "./applications";
import { maxApplicationsPerHour, maxPendingApplications, NOTICE_ICON_PATH, publicSiteUrl } from "./config";
import {
  DISCORD_AUTH_PATH, DISCORD_NAME_PATH, DISCORD_ORIGIN, DISCORD_RESUME_PATH, discordApi, discordId, discordSignupConfig,
  isDiscordWebhook, openDiscordCallbackCode, openWebhook, removeWebhook, sealDiscordCallbackCode, sealWebhook, toHex,
} from "./discord-connection";
import { renderSignupPlatformIcon } from "./signup-qr";
import { renderSiteHeader, SITE_SHELL_STYLESHEET } from "./site-header";
import type { Env } from "./types";

const COOKIE_NAME = "__Host-discord-signup";
const STATE_TTL_SECONDS = 600;

interface SignupPageOptions {
  clearCookie?: boolean;
  showForm?: boolean;
  nameError?: string;
}

function signupPage(
  title: string,
  detail: string,
  status: number,
  { clearCookie = false, showForm = false, nameError = "" }: SignupPageOptions = {},
): Response {
  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    // Browsers send Origin: null on form POSTs from documents using no-referrer.
    "Referrer-Policy": showForm ? "same-origin" : "no-referrer",
    "Strict-Transport-Security": "max-age=31536000",
    "X-Robots-Tag": "noindex",
    "Content-Security-Policy": "default-src 'none'; style-src 'self'; img-src 'self'; " +
      (showForm ? "script-src 'self'; " : "") +
      "form-action 'self' https://discord.com; base-uri 'none'; frame-ancestors 'none'",
  });
  if (clearCookie) headers.set("Set-Cookie", COOKIE_NAME + "=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");

  const form = showForm ? `<form class="signup-form" method="post" action="${DISCORD_NAME_PATH}">
        <div class="signup-field">
          <label for="name">성명</label>
          <input id="name" name="name" maxlength="48" required autocomplete="name"
            aria-describedby="name-error name-help"${nameError ? ' aria-invalid="true"' : ""}>
          <p class="signup-error" id="name-error" role="alert">${nameError}</p>
          <p class="signup-help" id="name-help">성명은 승인 심사를 위해 관리자에게 Telegram으로 전달됩니다.</p>
        </div>
        <button type="submit">신청하기</button>
      </form>` : "";

  return new Response(`<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title} · 보안공지 알리미</title>
  <link rel="icon" type="image/png" href="${NOTICE_ICON_PATH}">
  ${SITE_SHELL_STYLESHEET}
  <link rel="stylesheet" href="/assets/discord-signup.css">
  ${showForm ? '<script src="/assets/discord-signup.js" defer></script>' : ""}
</head>
<body>
  ${renderSiteHeader("보안공지 알리미", "/", { link: "archive" })}
  <main class="public-content discord-signup">
    <a class="signup-back" href="/"><span aria-hidden="true">←</span> 가입 페이지로 돌아가기</a>
    <section class="signup-card" aria-labelledby="signup-title">
      <div class="signup-mark">${renderSignupPlatformIcon("discord")}</div>
      <h1 id="signup-title">${title}</h1>
      <p class="signup-detail">${detail}</p>
      ${form}
    </section>
  </main>
</body>
</html>`, { status, headers });
}

function signupFormPage(status: number, nameError = ""): Response {
  return signupPage(
    "Discord 알림 신청",
    "연결한 채널에서 알림을 받으려면 본인의 성명을 입력해 주세요.",
    status,
    { showForm: true, nameError },
  );
}

type SignupConfig = NonNullable<ReturnType<typeof discordSignupConfig>>;

function signupCookie(request: Request): string | undefined {
  const cookie = request.headers.get("Cookie")?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(COOKIE_NAME + "="))?.slice(COOKIE_NAME.length + 1);
  return cookie && /^[a-f0-9]{64}$/.test(cookie) ? cookie : undefined;
}

function signupRedirect(location: string, state?: string): Response {
  const headers = new Headers({
    Location: location, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
    "Strict-Transport-Security": "max-age=31536000",
  });
  if (state) {
    headers.set("Set-Cookie", COOKIE_NAME + "=" + state + "; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=" + STATE_TTL_SECONDS);
  }
  return new Response(null, { status: 303, headers });
}

async function activeNameSession(env: Env, hash: string): Promise<boolean> {
  const record = await env.DB.prepare(
    "SELECT 1 AS found FROM discord_webhook_subscriptions " +
    "WHERE name_state_hash = ?1 AND name_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now') " +
    "AND applicant_name IS NULL AND approved_at IS NULL",
  ).bind(hash).first<{ found: number }>();
  return record?.found === 1;
}

async function rateLimited(request: Request, env: Env, stage: "start" | "name" | "handoff"): Promise<Response | null> {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const { success } = await env.DISCORD_SIGNUP_LIMITER.limit({ key: stage + ":" + ip });
  if (success) return null;
  const response = signupPage(
    "신청을 잠시 쉬어 주세요", "짧은 시간에 신청을 여러 번 시도했습니다. 1분 뒤 다시 시도해 주세요.",
    429, { showForm: stage === "name" },
  );
  response.headers.set("Retry-After", "60");
  return response;
}

export async function startDiscordSignup(request: Request, env: Env): Promise<Response> {
  const config = discordSignupConfig(env);
  if (!config) return signupPage("Discord 연결 준비 중", "연결이 완료되면 이 페이지에서 알림을 신청할 수 있습니다.", 503);
  // A name form opened before this version can restart at the Discord connection step.
  if (request.method === "POST") return signupRedirect(DISCORD_AUTH_PATH);
  const limited = await rateLimited(request, env, "start");
  if (limited) return limited;

  const cookie = signupCookie(request);
  if (cookie) {
    const hash = await sha256(cookie);
    if (await activeNameSession(env, hash)) return signupRedirect(DISCORD_NAME_PATH);
    const resumed = await resumeDiscordConnection(env, config, hash);
    if (resumed) return resumed;
  }

  const state = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now();
  const stored = await env.DB.prepare(
    "INSERT INTO discord_signup_states (state_hash, expires_at) SELECT ?1, ?2 " +
    "WHERE (SELECT COUNT(*) FROM discord_signup_states WHERE expires_at > ?3) < 100",
  ).bind(await sha256(state), new Date(now + STATE_TTL_SECONDS * 1000).toISOString(), new Date(now).toISOString()).run();
  if (stored.meta.changes !== 1) return signupPage("신청 대기 중", "잠시 후 다시 시도해 주세요.", 429);

  const authorize = new URL("/oauth2/authorize", DISCORD_ORIGIN);
  authorize.search = new URLSearchParams({
    client_id: config.clientId, redirect_uri: config.redirect, response_type: "code",
    scope: "identify webhook.incoming", prompt: "consent", state,
  }).toString();
  return signupRedirect(authorize.href, state);
}

function signupAccepted(): Response {
  return signupPage(
    "알림 신청 접수", "관리자가 승인하면 선택한 Discord 채널에서 이후 등록되는 보안공지를 받습니다.",
    200, { clearCookie: true },
  );
}

export async function submitDiscordName(request: Request, env: Env): Promise<Response> {
  if (!discordSignupConfig(env)) return signupPage("Discord 연결 준비 중", "가입 페이지에서 연결 상태를 확인해 주세요.", 503);
  if (request.method === "POST" && (
    request.headers.get("Origin") !== publicSiteUrl(env)?.origin ||
    !request.headers.get("Content-Type")?.startsWith("application/x-www-form-urlencoded")
  )) {
    return signupPage("신청을 확인할 수 없음", "가입 페이지에서 다시 신청해 주세요.", 403);
  }
  const expired = () => signupPage(
    "연결을 다시 시작해 주세요", "가입 페이지에서 Discord 채널을 다시 연결해 주세요.", 400, { clearCookie: true },
  );
  const cookie = signupCookie(request);
  if (!cookie) return expired();
  if (request.method === "POST") {
    const limited = await rateLimited(request, env, "name");
    if (limited) return limited;
  }
  const hash = await sha256(cookie);
  if (!await activeNameSession(env, hash)) return expired();
  if (request.method === "GET") return signupFormPage(200);

  const reader = request.body?.getReader();
  const bytes = new Uint8Array(4096);
  let offset = 0;
  if (reader) {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > bytes.byteLength) {
        await reader.cancel();
        return signupPage("입력이 너무 깁니다", "성명만 입력해 주세요.", 413, { showForm: true });
      }
      bytes.set(value, offset);
      offset += value.byteLength;
    }
  }
  const form = new URLSearchParams(new TextDecoder().decode(bytes.subarray(0, offset)));
  const submittedName = (form.get("name") ?? "").trim();
  const name = parseApplicantName(submittedName.split(/\s+/));
  if (!name) {
    return signupFormPage(400, submittedName ? "성명은 문자로 2~48자 입력해 주세요." : "성명을 입력해 주세요.");
  }
  const stored = await env.DB.prepare(
    "UPDATE discord_webhook_subscriptions " +
    "SET applicant_name = ?2, name_state_hash = NULL, name_expires_at = NULL, notify_after = ?3 " +
    "WHERE name_state_hash = ?1 AND name_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now') " +
    "AND applicant_name IS NULL AND approved_at IS NULL",
  ).bind(hash, name, new Date().toISOString()).run();
  return stored.meta.changes === 1 ? signupAccepted() : expired();
}

async function registerChannel(env: Env, config: SignupConfig, code: string, name: string | null): Promise<Response> {
  const token = await discordApi("/oauth2/token", {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "authorization_code", client_id: config.clientId, client_secret: config.clientSecret,
      code, redirect_uri: config.redirect,
    }),
  });
  if (!token.ok) throw new Error("Discord token exchange failed");
  const data = await token.json<{ webhook?: unknown; access_token?: unknown }>();
  if (!isDiscordWebhook(data.webhook)) throw new Error("Missing Discord webhook");
  const hook = data.webhook;
  let saved = false;
  try {
    if (typeof data.access_token !== "string") throw new Error("Missing Discord access token");
    const current = await discordApi("/users/@me", { headers: { Authorization: "Bearer " + data.access_token } });
    if (!current.ok) throw new Error("Discord identity lookup failed");
    const identity = await current.json<{ id?: string }>();
    if (!discordId(identity.id)) throw new Error("Invalid Discord user");
    const now = new Date();
    const requestedAt = now.toISOString();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const hourlyLimit = maxApplicationsPerHour(env);
    const nameState = name ? null : toHex(crypto.getRandomValues(new Uint8Array(32)));
    const nameStateHash = nameState ? await sha256(nameState) : null;
    const nameExpiresAt = nameState ? new Date(now.getTime() + STATE_TTL_SECONDS * 1000).toISOString() : null;
    const sealed = await sealWebhook(hook, config.key);
    const legacy = await env.DB.prepare(
      "SELECT id, sealed_webhook FROM discord_webhook_subscriptions " +
      "WHERE discord_user_id = ?1 AND approved_at IS NULL AND applicant_name IS NULL AND name_state_hash IS NULL",
    ).bind(identity.id).first<{ id: number; sealed_webhook: string }>();
    if (legacy) {
      const result = await env.DB.prepare(
        "UPDATE OR IGNORE discord_webhook_subscriptions " +
        "SET channel_id = ?2, sealed_webhook = ?3, applicant_name = ?4, name = NULL, requested_at = ?5, " +
        "notify_after = ?5, notified_at = NULL, name_state_hash = ?6, name_expires_at = ?7 " +
        "WHERE id = ?1 AND approved_at IS NULL AND applicant_name IS NULL AND name_state_hash IS NULL " +
        "AND (SELECT COUNT(*) FROM discord_webhook_subscriptions WHERE requested_at >= ?8 AND id <> ?1) < ?9",
      ).bind(legacy.id, hook.channel_id, sealed, name, requestedAt, nameStateHash, nameExpiresAt, oneHourAgo, hourlyLimit).run();
      saved = result.meta.changes === 1;
      if (saved) {
        try {
          await removeWebhook(await openWebhook(legacy.sealed_webhook, config.key));
        } catch {
          console.warn("Could not clear the previous Discord webhook.");
        }
      }
    } else {
      const result = await env.DB.prepare(
        "INSERT INTO discord_webhook_subscriptions " +
        "(discord_user_id, channel_id, sealed_webhook, applicant_name, requested_at, notify_after, name_state_hash, name_expires_at) " +
        "SELECT ?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7 " +
        "WHERE (SELECT COUNT(*) FROM discord_webhook_subscriptions WHERE approved_at IS NULL) < ?8 " +
        "AND (SELECT COUNT(*) FROM discord_webhook_subscriptions WHERE requested_at >= ?9) < ?10 " +
        "ON CONFLICT DO NOTHING",
      ).bind(
        identity.id, hook.channel_id, sealed, name, requestedAt, nameStateHash, nameExpiresAt,
        maxPendingApplications(env), oneHourAgo, hourlyLimit,
      ).run();
      saved = result.meta.changes === 1;
    }
    if (!saved) {
      return signupPage("알림 신청을 추가할 수 없음", "이미 신청한 계정이나 채널인지 확인해 주세요. 신규 신청 한도에 도달한 경우 나중에 다시 시도할 수 있습니다.", 409, { clearCookie: true });
    }
    return nameState ? signupRedirect(DISCORD_NAME_PATH, nameState) : signupAccepted();
  } finally {
    if (!saved) await removeWebhook(hook);
  }
}

export function resumeDiscordSignup(request: Request): Response {
  // Keep the short-lived handoff form from preceding deployments usable.
  if (request.method === "POST") return signupRedirect(DISCORD_AUTH_PATH);
  return signupPage(
    "처음 연 브라우저에서 이어가기",
    "처음 가입을 열었던 브라우저에서 ‘Discord에서 신청’을 다시 누르면 성명 입력이 이어집니다. 처음 창을 닫았다면 기본 브라우저에서 다시 시작해 주세요.",
    200,
  );
}

async function resumeDiscordConnection(env: Env, config: SignupConfig, hash: string): Promise<Response | null> {
  const record = await env.DB.prepare(
    "DELETE FROM discord_signup_states WHERE state_hash = ?1 AND expires_at > ?2 " +
    "AND sealed_callback_code IS NOT NULL RETURNING applicant_name, sealed_callback_code",
  ).bind(hash, new Date().toISOString()).first<{ applicant_name: string | null; sealed_callback_code: string }>();
  if (!record) return null;
  try {
    const code = await openDiscordCallbackCode(record.sealed_callback_code, config.key, hash);
    return await registerChannel(env, config, code, record.applicant_name);
  } catch {
    console.error("Deferred Discord OAuth signup could not be completed.");
    return signupPage("채널 연결 실패", "가입 페이지에서 연결을 다시 시작해 주세요.", 502, { clearCookie: true });
  }
}

export async function completeDiscordSignup(request: Request, env: Env): Promise<Response> {
  const config = discordSignupConfig(env);
  if (!config) return signupPage("Discord 연결 준비 중", "가입 페이지에서 연결 상태를 확인해 주세요.", 503);
  const params = new URL(request.url).searchParams;
  const state = params.get("state") ?? "";
  const cookie = signupCookie(request);
  const issuer = params.get("iss");
  if (!/^[a-f0-9]{64}$/.test(state) || (issuer && issuer !== DISCORD_ORIGIN)) {
    return signupPage("신청을 확인할 수 없음", "가입 페이지에서 다시 신청해 주세요.", 403);
  }
  const code = params.get("code");
  const authorized = code && code.length <= 512 && !params.has("error");
  const hash = await sha256(state);
  if (cookie !== state) {
    if (!authorized) {
      return signupPage("신청을 확인할 수 없음", "처음 가입을 시작한 브라우저에서 다시 신청해 주세요.", 403);
    }
    const limited = await rateLimited(request, env, "handoff");
    if (limited) return limited;
    // Hold the code without exchanging it. Only the original browser can consume it.
    const sealed = await sealDiscordCallbackCode(code, config.key, hash);
    const stored = await env.DB.prepare(
      "UPDATE discord_signup_states SET sealed_callback_code = COALESCE(sealed_callback_code, ?2) " +
      "WHERE state_hash = ?1 AND expires_at > ?3",
    ).bind(hash, sealed, new Date().toISOString()).run();
    if (stored.meta.changes === 1) return signupRedirect(DISCORD_RESUME_PATH);
    return signupPage("신청 시간이 만료됨", "가입 페이지에서 다시 신청해 주세요.", 400);
  }
  const record = await env.DB.prepare(
    "DELETE FROM discord_signup_states WHERE state_hash = ?1 AND expires_at > ?2 RETURNING applicant_name",
  ).bind(hash, new Date().toISOString()).first<{ applicant_name: string | null }>();
  if (!record) return signupPage("신청 시간이 만료됨", "가입 페이지에서 다시 신청해 주세요.", 400, { clearCookie: true });
  if (!authorized) {
    return signupPage("채널 연결 취소", "Discord에 알림을 받으려면 채널 선택을 완료해 주세요.", 400, { clearCookie: true });
  }
  try {
    return await registerChannel(env, config, code, record.applicant_name);
  } catch {
    console.error("Discord OAuth signup could not be completed.");
    return signupPage("채널 연결 실패", "Discord 채널 권한을 확인한 뒤 다시 신청해 주세요.", 502, { clearCookie: true });
  }
}

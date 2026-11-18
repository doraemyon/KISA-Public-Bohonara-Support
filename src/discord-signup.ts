import { sha256 } from "./access";
import { parseApplicantName } from "./applications";
import { maxApplicationsPerHour, maxPendingApplications, publicSiteUrl } from "./config";
import {
  DISCORD_AUTH_PATH, DISCORD_ORIGIN, discordApi, discordId, discordSignupConfig, isDiscordWebhook, openWebhook,
  removeWebhook, sealWebhook, toHex,
} from "./discord-connection";
import type { Env } from "./types";

const COOKIE_NAME = "__Host-discord-signup";
const STATE_TTL_SECONDS = 600;

function signupPage(title: string, detail: string, status: number, clearCookie = false, showForm = false): Response {
  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
    // Browsers send Origin: null on form POSTs from documents using no-referrer.
    "Referrer-Policy": showForm ? "same-origin" : "no-referrer",
    "Strict-Transport-Security": "max-age=31536000",
    "X-Robots-Tag": "noindex",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://discord.com; base-uri 'none'; frame-ancestors 'none'",
  });
  if (clearCookie) headers.set("Set-Cookie", COOKIE_NAME + "=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  const form = showForm ? '<form method="post" action="' + DISCORD_AUTH_PATH + '">' +
    '<label for="name">성명</label><input id="name" name="name" maxlength="48" required autocomplete="name">' +
    '<small>성명은 승인 심사를 위해 관리자에게 Telegram으로 전달됩니다.</small><button type="submit">Discord에서 채널 선택</button></form>' : "";
  return new Response('<!doctype html><html lang="ko"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"><title>Discord 보안공지 신청</title>' +
    '<style>body{margin:0;background:#0d1117;color:#f0f6fc;font:16px/1.6 system-ui,sans-serif}' +
    'main{max-width:480px;margin:8vh auto;padding:24px}h1{font-size:26px}p,small{color:#aab4c1}a{color:#8dc2ff}' +
    'form{margin:24px 0;display:grid;gap:10px}input,button{box-sizing:border-box;min-height:44px;border-radius:6px;padding:8px 12px;font:inherit}' +
    'input{width:100%;background:#161b22;color:inherit;border:1px solid #4c5665}button{background:#454fbf;color:white;border:0;cursor:pointer}</style>' +
    '</head><body><main><h1>' + title + '</h1><p>' + detail + '</p>' + form +
    '<a href="/">가입 페이지로 돌아가기</a></main></body></html>', { status, headers });
}

type SignupConfig = NonNullable<ReturnType<typeof discordSignupConfig>>;

export async function startDiscordSignup(request: Request, env: Env): Promise<Response> {
  const config = discordSignupConfig(env);
  if (!config) return signupPage("Discord 연결 준비 중", "연결이 완료되면 이 페이지에서 알림을 신청할 수 있습니다.", 503);
  if (request.method === "GET") {
    return signupPage("Discord 알림 신청", "본인의 성명을 입력하면 Discord에서 알림을 받을 채널을 선택할 수 있습니다.", 200, false, true);
  }
  if (request.headers.get("Origin") !== publicSiteUrl(env)?.origin ||
      !request.headers.get("Content-Type")?.startsWith("application/x-www-form-urlencoded")) {
    return signupPage("신청을 시작할 수 없음", "가입 페이지에서 다시 신청해 주세요.", 403);
  }
  const clientKey = request.headers.get("CF-Connecting-IP") || "unknown";
  const { success } = await env.DISCORD_SIGNUP_LIMITER.limit({ key: clientKey });
  if (!success) {
    const response = signupPage("신청을 잠시 쉬어 주세요", "짧은 시간에 신청을 여러 번 시도했습니다. 1분 뒤 다시 시도해 주세요.", 429, false, true);
    response.headers.set("Retry-After", "60");
    return response;
  }
  const reader = request.body?.getReader();
  const bytes = new Uint8Array(4096);
  let offset = 0;
  if (reader) {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > bytes.byteLength) {
        await reader.cancel();
        return signupPage("입력이 너무 깁니다", "성명만 입력해 주세요.", 413, false, true);
      }
      bytes.set(value, offset);
      offset += value.byteLength;
    }
  }
  const form = new URLSearchParams(new TextDecoder().decode(bytes.subarray(0, offset)));
  const name = parseApplicantName((form.get("name") ?? "").trim().split(/\s+/));
  if (!name) return signupPage("성명을 확인해 주세요", "본인의 성명을 입력해 주세요.", 400, false, true);
  const state = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now();
  const stored = await env.DB.prepare(
    "INSERT INTO discord_signup_states (state_hash, expires_at, applicant_name) SELECT ?1, ?2, ?3 " +
    "WHERE (SELECT COUNT(*) FROM discord_signup_states WHERE expires_at > ?4) < 100",
  ).bind(await sha256(state), new Date(now + STATE_TTL_SECONDS * 1000).toISOString(), name, new Date(now).toISOString()).run();
  if (stored.meta.changes !== 1) return signupPage("신청 대기 중", "잠시 후 다시 시도해 주세요.", 429, false, true);
  const authorize = new URL("/oauth2/authorize", DISCORD_ORIGIN);
  authorize.search = new URLSearchParams({
    client_id: config.clientId, redirect_uri: config.redirect, response_type: "code",
    scope: "identify webhook.incoming", prompt: "consent", state,
  }).toString();
  return new Response(null, {
    status: 303,
    headers: {
      Location: authorize.href, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
      "Set-Cookie": COOKIE_NAME + "=" + state + "; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=" + STATE_TTL_SECONDS,
    },
  });
}

async function registerChannel(env: Env, config: SignupConfig, code: string, name: string): Promise<Response> {
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
    const sealed = await sealWebhook(hook, config.key);
    const legacy = await env.DB.prepare(
      "SELECT id, sealed_webhook FROM discord_webhook_subscriptions " +
      "WHERE discord_user_id = ?1 AND approved_at IS NULL AND applicant_name IS NULL",
    ).bind(identity.id).first<{ id: number; sealed_webhook: string }>();
    if (legacy) {
      const result = await env.DB.prepare(
        "UPDATE OR IGNORE discord_webhook_subscriptions " +
        "SET channel_id = ?2, sealed_webhook = ?3, applicant_name = ?4, name = NULL, requested_at = ?5, notify_after = ?5, notified_at = NULL " +
        "WHERE id = ?1 AND approved_at IS NULL AND applicant_name IS NULL " +
        "AND (SELECT COUNT(*) FROM discord_webhook_subscriptions WHERE requested_at >= ?6) < ?7",
      ).bind(legacy.id, hook.channel_id, sealed, name, requestedAt, oneHourAgo, hourlyLimit).run();
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
        "INSERT INTO discord_webhook_subscriptions (discord_user_id, channel_id, sealed_webhook, applicant_name, requested_at, notify_after) " +
        "SELECT ?1, ?2, ?3, ?4, ?5, ?5 " +
        "WHERE (SELECT COUNT(*) FROM discord_webhook_subscriptions WHERE approved_at IS NULL) < ?6 " +
        "AND (SELECT COUNT(*) FROM discord_webhook_subscriptions WHERE requested_at >= ?7) < ?8 " +
        "ON CONFLICT DO NOTHING",
      ).bind(identity.id, hook.channel_id, sealed, name, requestedAt, maxPendingApplications(env), oneHourAgo, hourlyLimit).run();
      saved = result.meta.changes === 1;
    }
    return saved
      ? signupPage("알림 신청 접수", "관리자가 승인하면 선택한 Discord 채널에서 이후 등록되는 보안공지를 받습니다.", 200, true)
      : signupPage("알림 신청을 추가할 수 없음", "이미 신청한 계정이나 채널인지 확인해 주세요. 신규 신청 한도에 도달한 경우 나중에 다시 시도할 수 있습니다.", 409, true);
  } finally {
    if (!saved) await removeWebhook(hook);
  }
}

export async function completeDiscordSignup(request: Request, env: Env): Promise<Response> {
  const config = discordSignupConfig(env);
  if (!config) return signupPage("Discord 연결 준비 중", "가입 페이지에서 연결 상태를 확인해 주세요.", 503);
  const params = new URL(request.url).searchParams;
  const state = params.get("state") ?? "";
  const cookie = request.headers.get("Cookie")?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(COOKIE_NAME + "="))?.slice(COOKIE_NAME.length + 1);
  const issuer = params.get("iss");
  if (!/^[a-f0-9]{64}$/.test(state) || cookie !== state || (issuer && issuer !== DISCORD_ORIGIN)) {
    return signupPage("신청을 확인할 수 없음", "가입 페이지에서 다시 신청해 주세요.", 403);
  }
  const record = await env.DB.prepare(
    "DELETE FROM discord_signup_states WHERE state_hash = ?1 AND expires_at > ?2 RETURNING applicant_name",
  ).bind(await sha256(state), new Date().toISOString()).first<{ applicant_name: string | null }>();
  if (!record?.applicant_name) return signupPage("신청 시간이 만료됨", "가입 페이지에서 다시 신청해 주세요.", 400, true);
  const code = params.get("code");
  if (!code || code.length > 512 || params.has("error")) {
    return signupPage("채널 연결 취소", "Discord에 알림을 받으려면 채널 선택을 완료해 주세요.", 400, true);
  }
  try {
    return await registerChannel(env, config, code, record.applicant_name);
  } catch {
    console.error("Discord OAuth signup could not be completed.");
    return signupPage("채널 연결 실패", "Discord 채널 권한을 확인한 뒤 다시 신청해 주세요.", 502, true);
  }
}

import { afterEach, expect, it, vi } from "vitest";
import { sha256 } from "../src/access";
import { discordSignupConfig, openDiscordCallbackCode, openWebhook, sealWebhook } from "../src/discord-connection";
import { completeDiscordSignup, resumeDiscordSignup, startDiscordSignup, submitDiscordName } from "../src/discord-signup";
import { discordNoticeMessage, handleDiscordCallback, processDiscordNotices } from "../src/discord";
import worker from "../src/index";
import { renderOnboardingPage } from "../src/onboarding";
import type { Env, TelegramCallbackQuery } from "../src/types";

const origin = "https://alerts.example.test";
const env = {
  PUBLIC_BASE_URL: origin, BOT_USERNAME: "KisaNoticeBot",
  DISCORD_CLIENT_ID: "123456789012345671",
  DISCORD_SIGNUP_LIMITER: { limit: async () => ({ success: true }) },
  DISCORD_CLIENT_SECRET: "test-oauth-settings-secret",
  DISCORD_WEBHOOK_KEY: "ab".repeat(32),
  ADMIN_TELEGRAM_USER_ID: "100", TELEGRAM_BOT_TOKEN: "mock-telegram-token",
} as Partial<Env> as Env;
const signupUrl = origin + "/discord/subscribe";
const nameUrl = signupUrl + "/name";
const nameCookie = "__Host-discord-signup=" + "a".repeat(64);
const hook = { id: "123456789012345674", token: "test-separate-channel-webhook", channel_id: "123456789012345675" };

afterEach(() => vi.unstubAllGlobals());

it("renders a QR for the signup page only when OAuth settings are available", () => {
  const page = renderOnboardingPage(env);
  expect(page).toContain(origin + "/discord/subscribe");
  expect(page).toContain('aria-label="Discord 가입 QR 코드"');
  expect(page).toContain("data-discord-logo");
  expect(page).toContain('for="choose-discord"');
  expect(page).toContain("내 Discord 계정이 관리할 수 있는 서버");
  expect(renderOnboardingPage(env)).toContain('href="/notices/"');
  const disabled = { ...env, DISCORD_CLIENT_SECRET: undefined };
  expect(discordSignupConfig(disabled)).toBeNull();
  expect(renderOnboardingPage(disabled)).toContain("Discord 구독 신청은 연결 준비 중입니다.");
});

it("requires HTTPS for the connection and the name form", async () => {
  const ctx = {} as ExecutionContext;
  const get = await worker.fetch(new Request(signupUrl.replace("https:", "http:")), env, ctx);
  expect(get.status).toBe(308);
  expect(get.headers.get("Location")).toBe(signupUrl);
  const post = await worker.fetch(new Request(nameUrl.replace("https:", "http:"), {
    method: "POST", headers: { Origin: origin }, body: new URLSearchParams({ name: "가상검증" }),
  }), env, ctx);
  expect(post.status).toBe(400);
  expect(post.headers.has("Location")).toBe(false);
  const form = await worker.fetch(new Request(nameUrl), env, ctx);
  expect(form.status).toBe(400);
  expect(form.headers.get("Strict-Transport-Security")).toBe("max-age=31536000");
});

it.each([null, "null", "https://other.example.test"])("rejects the name POST from origin %s", async (source) => {
  const prepare = vi.fn();
  const live = { ...env, DB: { prepare } as unknown as D1Database };
  const headers = new Headers({ Cookie: nameCookie });
  if (source) headers.set("Origin", source);
  const response = await submitDiscordName(new Request(nameUrl, {
    method: "POST", headers, body: new URLSearchParams({ name: "가상검증" }),
  }), live);
  expect(response.status).toBe(403);
  expect(prepare).not.toHaveBeenCalled();
});

it("rate-limits authorization and name submissions before allocating database state", async () => {
  const prepare = vi.fn();
  const limit = vi.fn(async (_options: RateLimitOptions) => ({ success: false }));
  const live = { ...env, DISCORD_SIGNUP_LIMITER: { limit }, DB: { prepare } as unknown as D1Database };
  const start = await startDiscordSignup(new Request(signupUrl, { headers: { "CF-Connecting-IP": "192.0.2.2" } }), live);
  expect(start.status).toBe(429);
  expect(start.headers.get("Retry-After")).toBe("60");
  const post = new Request(nameUrl, {
    method: "POST",
    headers: { Origin: origin, Cookie: nameCookie, "CF-Connecting-IP": "192.0.2.2" },
    body: new URLSearchParams({ name: "가상검증" }),
  });
  expect((await submitDiscordName(post, live)).status).toBe(429);
  expect(limit.mock.calls).toEqual([[{ key: "start:192.0.2.2" }], [{ key: "name:192.0.2.2" }]]);
  expect(post.bodyUsed).toBe(false);
  expect(prepare).not.toHaveBeenCalled();
});

it.each([
  ["  ", "성명을 입력해 주세요."],
  ["<script>", "성명은 문자로 2~48자 입력해 주세요."],
])("shows a name-field error after authorization for invalid input (%j)", async (name, message) => {
  const prepare = vi.fn(() => ({ bind: () => ({ first: async () => ({ found: 1 }) }) }));
  const response = await submitDiscordName(new Request(nameUrl, {
    method: "POST", headers: { Origin: origin, Cookie: nameCookie }, body: new URLSearchParams({ name }),
  }), { ...env, DB: { prepare } as unknown as D1Database });
  const page = await response.text();
  expect(response.status).toBe(400);
  expect(response.headers.get("Referrer-Policy")).toBe("same-origin");
  expect(page).toContain('aria-describedby="name-error name-help" aria-invalid="true"');
  expect(page).toContain('id="name-error" role="alert">' + message + '</p>');
  expect(page).not.toContain("<script>");
  expect(prepare).toHaveBeenCalledTimes(1);
});

it.each([null, "김하늘"])("completes current and pre-deployment OAuth sessions (%j)", async (legacyName) => {
  const write = vi.fn(async () => ({ meta: { changes: 1 } }));
  const finish = vi.fn((..._params: unknown[]) => ({ run: write }));
  const consume = vi.fn().mockResolvedValueOnce({ applicant_name: legacyName }).mockResolvedValue(null);
  const selectName = vi.fn();
  const prepare = vi.fn((query: string) => {
    if (query.startsWith("DELETE FROM discord_signup_states")) return { bind: () => ({ first: consume }) };
    if (query.startsWith("SELECT id, sealed_webhook")) {
      return { bind: () => ({ first: async () => null }) };
    }
    if (query.startsWith("SELECT 1 AS found")) return { bind: selectName };
    if (query.startsWith("UPDATE discord_webhook_subscriptions")) return { bind: finish };
    return { bind: vi.fn(() => ({ run: write })) };
  });
  const live = { ...env, DB: { prepare } as unknown as D1Database };

  const go = await startDiscordSignup(new Request(signupUrl), live);
  expect(go.status).toBe(303);
  expect(go.headers.get("Referrer-Policy")).toBe("no-referrer");
  const auth = new URL(go.headers.get("Location")!);
  expect(auth.origin).toBe("https://discord.com");
  expect(auth.searchParams.get("scope")).toBe("identify webhook.incoming");
  expect(auth.href).not.toContain(env.DISCORD_CLIENT_SECRET);
  expect(await go.text()).toBe("");
  const state = auth.searchParams.get("state")!;
  const cookie = go.headers.get("Set-Cookie")!.split(";")[0];
  const callbackUrl = origin + "/discord/callback?code=callback-code&state=" + state;

  const network = vi.fn(async (url: string) => url.endsWith("/oauth2/token")
    ? Response.json({ webhook: hook, access_token: "short-lived-access" })
    : Response.json({ id: "123456789012345676", username: "other-name" }));
  vi.stubGlobal("fetch", network);
  const mismatchedIssuer = new URL(callbackUrl);
  mismatchedIssuer.searchParams.set("iss", "https://other.example.test");
  expect((await completeDiscordSignup(new Request(mismatchedIssuer), live)).status).toBe(403);
  expect(network).not.toHaveBeenCalled();
  const callback = await completeDiscordSignup(new Request(callbackUrl, { headers: { Cookie: cookie } }), live);
  expect((await completeDiscordSignup(new Request(callbackUrl, { headers: { Cookie: cookie } }), live)).status).toBe(400);
  expect(network).toHaveBeenCalledTimes(2);

  const statement = prepare.mock.results[prepare.mock.calls.findIndex(([query]) =>
    query.startsWith("INSERT INTO discord_webhook_subscriptions"))].value;
  const [, channelId, sealed, savedName, , storedHash, expiresAt] = vi.mocked(statement.bind).mock.calls[0] as unknown as (string | null)[];
  expect(channelId).toBe(hook.channel_id);
  expect(sealed).not.toContain(hook.token);
  expect(await openWebhook(sealed!, env.DISCORD_WEBHOOK_KEY!)).toEqual(hook);
  expect(savedName).toBe(legacyName);

  if (legacyName) {
    expect(callback.status).toBe(200);
    expect(storedHash).toBeNull();
    expect(await callback.text()).toContain("알림 신청 접수");
    return;
  }

  expect(callback.status).toBe(303);
  expect(callback.headers.get("Location")).toBe("/discord/subscribe/name");
  const continuation = callback.headers.get("Set-Cookie")!.split(";")[0];
  expect(continuation).not.toBe(cookie);
  expect(await sha256(continuation.split("=")[1])).toBe(storedHash);
  expect(expiresAt).not.toBeNull();
  selectName.mockImplementation((hash: string) => ({
    first: async () => hash === storedHash ? { found: 1 } : null,
  }));

  expect((await submitDiscordName(new Request(nameUrl, { headers: { Cookie: cookie } }), live)).status).toBe(400);
  const form = await submitDiscordName(new Request(nameUrl, { headers: { Cookie: continuation } }), live);
  expect(form.status).toBe(200);
  expect(form.headers.get("Referrer-Policy")).toBe("same-origin");
  expect(await form.text()).toContain('name="name"');
  const result = await submitDiscordName(new Request(nameUrl, {
    method: "POST", headers: { Origin: origin, Cookie: continuation },
    body: new URLSearchParams({ name: "김하늘" }),
  }), live);
  expect(finish).toHaveBeenCalledWith(storedHash, "김하늘", expect.any(String));
  expect(result.status).toBe(200);
  expect(result.headers.get("Set-Cookie")).toContain("Max-Age=0");
  expect(await result.text()).toContain("알림 신청 접수");
});

it("resumes a mobile callback once in the browser that started it", async () => {
  const state = "f".repeat(64);
  const hash = await sha256(state);
  const startCookie = "__Host-discord-signup=" + state;
  const otherCookie = "__Host-discord-signup=" + "e".repeat(64);
  const code = "one-time-mobile-code";
  const resumeUrl = signupUrl + "/resume";
  let stored: string | null = null;
  const prepare = vi.fn((sql: string) => ({
    bind: (...values: string[]) => ({
      run: async () => {
        if (sql.startsWith("UPDATE discord_signup_states")) {
          if (values[0] !== hash) return { meta: { changes: 0 } };
          stored ??= values[1];
        }
        return { meta: { changes: 1 } };
      },
      first: async () => {
        if (values[0] !== hash || stored === null) return null;
        if (sql.startsWith("DELETE FROM discord_signup_states")) {
          const result = { applicant_name: null, sealed_callback_code: stored };
          stored = null;
          return result;
        }
        return null;
      },
    }),
  }));
  const live = { ...env, DB: { prepare } as unknown as D1Database };
  const network = vi.fn(async (url: string, _init: RequestInit) => url.endsWith("/oauth2/token")
    ? Response.json({ webhook: hook, access_token: "short-lived-access" })
    : Response.json({ id: "123456789012345676" }));
  vi.stubGlobal("fetch", network);

  const callback = origin + "/discord/callback?code=" + code + "&state=" + state;
  const handoff = await completeDiscordSignup(new Request(callback, { headers: { Cookie: otherCookie } }), live);
  expect(handoff.status).toBe(303);
  expect(handoff.headers.get("Location")).toBe("/discord/subscribe/resume");
  expect(handoff.headers.has("Set-Cookie")).toBe(false);
  expect(stored).not.toContain(code);
  expect(stored).not.toBeNull();
  await expect(openDiscordCallbackCode(stored!, env.DISCORD_WEBHOOK_KEY!, hash)).resolves.toBe(code);
  await expect(openDiscordCallbackCode(stored!, env.DISCORD_WEBHOOK_KEY!, await sha256(otherCookie))).rejects.toThrow();
  expect(network).not.toHaveBeenCalled();

  const instructions = resumeDiscordSignup(new Request(resumeUrl));
  expect(await instructions.text()).toContain("처음 연 브라우저에서 이어가기");
  const unrelated = await startDiscordSignup(new Request(signupUrl, { headers: { Cookie: otherCookie } }), live);
  expect(new URL(unrelated.headers.get("Location")!).origin).toBe("https://discord.com");
  expect(network).not.toHaveBeenCalled();

  const resume = () => new Request(signupUrl, { headers: { Cookie: startCookie } });
  const completed = await startDiscordSignup(resume(), live);
  expect(completed.status).toBe(303);
  expect(completed.headers.get("Location")).toBe("/discord/subscribe/name");
  expect((network.mock.calls[0][1].body as URLSearchParams).get("code")).toBe(code);
  const replay = await startDiscordSignup(resume(), live);
  expect(new URL(replay.headers.get("Location")!).origin).toBe("https://discord.com");
  expect(network).toHaveBeenCalledTimes(2);
});

it("retries expired OAuth connections until Discord removes the unused webhook", async () => {
  const cleanup = vi.fn(async () => ({ meta: { changes: 1 } }));
  const expired = {
    id: 3, name_state_hash: "expired-state", sealed_webhook: await sealWebhook(hook, env.DISCORD_WEBHOOK_KEY!),
  };
  const prepare = (sql: string) => ({
    bind: () => ({
      all: async () => ({ results: sql.startsWith("SELECT id, name_state_hash,") ? [expired] : [] }),
      run: cleanup,
    }),
  });
  const live = { ...env, DB: { prepare, batch: async () => [] } as unknown as D1Database };
  const remove = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", remove);
  await processDiscordNotices(live);
  expect(cleanup).not.toHaveBeenCalled();
  await processDiscordNotices(live);
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledTimes(2);
  expect(remove.mock.calls[0][1].method).toBe("DELETE");
});

it("restricts approval to the configured Telegram admin chat", async () => {
  const db = vi.fn(() => ({ bind: () => ({ run: async () => ({ meta: { changes: 1 } }) }) }));
  const live = { ...env, DB: { prepare: db } as unknown as D1Database };
  const send = vi.fn(async () => Response.json({ ok: true }));
  vi.stubGlobal("fetch", send);
  const callback: TelegramCallbackQuery = {
    id: "1", data: "discord-name:approve:1", from: { id: 100 },
    message: { message_id: 1, chat: { id: 101, type: "private" } },
  };
  await handleDiscordCallback(live, callback);
  expect(db).not.toHaveBeenCalled();
  callback.message!.chat.id = 100;
  await handleDiscordCallback(live, { ...callback, data: "discord:approve:1" });
  expect(db).not.toHaveBeenCalled();
  send.mockClear();
  await handleDiscordCallback(live, callback);
  expect(db).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledTimes(2);
});

it("keeps notice links and sends no mention for an invalid recipient", () => {
  const message = discordNoticeMessage(env, {
    discord_user_id: "@everyone", title: "@everyone 보안 공지",
    link: "https://www.boho.or.kr/kr/bbs/view.do?nttId=72263", published_at: "2026-11-17",
  });
  expect(message.content).toBeUndefined();
  expect(message.allowed_mentions).toEqual({ parse: [], users: [] });
  expect(message.components[0].components.map((button) => button.label)).toEqual(["공지 열기", "국문 공지", "영문 공지"]);
});

it.each([0, 1])("mentions only the subscriber in queued Discord notices (test: %i)", async (isTest) => {
  const recipient = "123456789012345676";
  const delivery = {
    subscription_id: 2, discord_user_id: recipient, notice_id: "72263",
    title: "@everyone 보안 공지", link: "https://www.boho.or.kr/kr/bbs/view.do?nttId=72263",
    published_at: "2026-11-17", attempts: 0, is_test: isTest,
    sealed_webhook: await sealWebhook(hook, env.DISCORD_WEBHOOK_KEY!),
  };
  const prepare = vi.fn((sql: string) => ({
    bind: () => ({
      all: async () => ({ results: sql.startsWith("SELECT d.subscription_id,") ? [delivery] : [] }),
      run: async () => ({ meta: { changes: 1 } }),
    }),
  }));
  const live = { ...env, DB: { prepare, batch: async () => [] } as unknown as D1Database };
  const send = vi.fn(async (_url: string, _options: RequestInit) => new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", send);

  await processDiscordNotices(live);

  expect(prepare).toHaveBeenCalledWith(expect.stringMatching(/^SELECT d\.subscription_id, s\.discord_user_id,/));
  expect(send).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(send.mock.calls[0][1].body))).toMatchObject({
    content: "<@" + recipient + ">",
    allowed_mentions: { parse: [], users: [recipient] },
    embeds: [{ title: isTest ? "[연동 테스트] " + delivery.title : delivery.title }],
    components: [{ components: [{ label: "공지 열기" }, { label: "국문 공지" }, { label: "영문 공지" }] }],
  });
});

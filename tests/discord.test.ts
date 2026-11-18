import { afterEach, expect, it, vi } from "vitest";
import { discordSignupConfig, openWebhook, sealWebhook } from "../src/discord-connection";
import { completeDiscordSignup, startDiscordSignup } from "../src/discord-signup";
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

it("requires HTTPS on the public signup form", async () => {
  const signupUrl = origin + "/discord/subscribe";
  const insecureUrl = signupUrl.replace("https:", "http:");
  const ctx = {} as ExecutionContext;
  const get = await worker.fetch(new Request(insecureUrl), env, ctx);
  expect(get.status).toBe(308);
  expect(get.headers.get("Location")).toBe(signupUrl);
  const post = await worker.fetch(new Request(insecureUrl, {
    method: "POST", headers: { Origin: origin }, body: new URLSearchParams({ name: "가상검증" }),
  }), env, ctx);
  expect(post.status).toBe(400);
  expect(post.headers.has("Location")).toBe(false);
  const form = await worker.fetch(new Request(signupUrl), env, ctx);
  expect(form.headers.get("Strict-Transport-Security")).toBe("max-age=31536000");
});

it.each([null, "null", "https://other.example.test"])("rejects the form POST from origin %s", async (source) => {
  const prepare = vi.fn();
  const live = { ...env, DB: { prepare } as unknown as D1Database };
  const response = await startDiscordSignup(new Request(origin + "/discord/subscribe", {
    method: "POST", headers: source ? { Origin: source } : {},
    body: new URLSearchParams({ name: "가상검증" }),
  }), live);
  expect(response.status).toBe(403);
  expect(prepare).not.toHaveBeenCalled();
});

it("rate-limits Discord submissions by Cloudflare IP before reading names or writing OAuth state", async () => {
  const prepare = vi.fn();
  const limit = vi.fn(async () => ({ success: false }));
  const live = {
    ...env, DISCORD_SIGNUP_LIMITER: { limit },
    DB: { prepare } as unknown as D1Database,
  };
  const url = origin + "/discord/subscribe";
  expect((await startDiscordSignup(new Request(url), live)).status).toBe(200);
  expect(limit).not.toHaveBeenCalled();
  const post = new Request(url, {
    method: "POST",
    headers: { Origin: origin, "CF-Connecting-IP": "192.0.2.2" },
    body: new URLSearchParams({ name: "가상검증" }),
  });
  const response = await startDiscordSignup(post, live);
  expect(response.status).toBe(429);
  expect(response.headers.get("Retry-After")).toBe("60");
  expect(limit).toHaveBeenCalledWith({ key: "192.0.2.2" });
  expect(post.bodyUsed).toBe(false);
  expect(prepare).not.toHaveBeenCalled();
});

it.each([
  ["  ", "성명을 입력해 주세요."],
  ["<script>", "성명은 문자로 2~48자 입력해 주세요."],
])("shows a name-field error for invalid input (%j)", async (name, message) => {
  const prepare = vi.fn();
  const response = await startDiscordSignup(new Request(origin + "/discord/subscribe", {
    method: "POST", headers: { Origin: origin }, body: new URLSearchParams({ name }),
  }), { ...env, DB: { prepare } as unknown as D1Database });
  const page = await response.text();
  expect(response.status).toBe(400);
  expect(response.headers.get("Referrer-Policy")).toBe("same-origin");
  expect(page).toContain('aria-describedby="name-error name-help" aria-invalid="true"');
  expect(page).toContain('id="name-error" role="alert">' + message + '</p>');
  expect(page).not.toContain("<script>");
  expect(prepare).not.toHaveBeenCalled();
});

it("redeems a same-browser state once and stores only an encrypted webhook for review", async () => {
  const insert = vi.fn(async () => ({ meta: { changes: 1 } }));
  const consume = vi.fn().mockResolvedValueOnce({ applicant_name: "김하늘" }).mockResolvedValue(null);
  const bind = vi.fn(() => ({ first: consume, run: insert }));
  const live = { ...env, DB: { prepare: () => ({ bind }) } as unknown as D1Database };
  const start = await startDiscordSignup(new Request(origin + "/discord/subscribe"), live);
  expect(start.headers.get("Referrer-Policy")).toBe("same-origin");
  expect(await start.text()).toContain('name="name"');
  expect(bind).not.toHaveBeenCalled();
  const go = await startDiscordSignup(new Request(origin + "/discord/subscribe", {
    method: "POST", headers: { Origin: origin },
    body: new URLSearchParams({ name: "김하늘" }),
  }), live);
  expect(go.status).toBe(303);
  expect(go.headers.get("Referrer-Policy")).toBe("no-referrer");
  const auth = new URL(go.headers.get("Location")!);
  expect(auth.origin).toBe("https://discord.com");
  expect(auth.searchParams.get("scope")).toBe("identify webhook.incoming");
  expect(auth.href).not.toContain(env.DISCORD_CLIENT_SECRET);
  expect(decodeURIComponent(auth.href)).not.toContain("김하늘");
  const state = auth.searchParams.get("state");
  const cookie = go.headers.get("Set-Cookie")!.split(";")[0];
  const callbackUrl = origin + "/discord/callback?code=callback-code&state=" + state;

  const network = vi.fn(async (url: string) => url.endsWith("/oauth2/token")
    ? Response.json({ webhook: hook, access_token: "short-lived-access" })
    : Response.json({ id: "123456789012345676", username: "other-name", global_name: "다른 표시 이름" }));
  vi.stubGlobal("fetch", network);
  expect((await completeDiscordSignup(new Request(callbackUrl), live)).status).toBe(403);
  expect(network).not.toHaveBeenCalled();
  expect((await completeDiscordSignup(new Request(callbackUrl, { headers: { Cookie: cookie } }), live)).status).toBe(200);
  expect((await completeDiscordSignup(new Request(callbackUrl, { headers: { Cookie: cookie } }), live)).status).toBe(400);
  expect(network).toHaveBeenCalledTimes(2);
  const [, channelId, sealed, name] = bind.mock.calls.at(-2) as unknown as string[];
  expect(channelId).toBe(hook.channel_id);
  expect(name).toBe("김하늘");
  expect(sealed).not.toContain(hook.token);
  expect(await openWebhook(sealed, env.DISCORD_WEBHOOK_KEY!)).toEqual(hook);
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

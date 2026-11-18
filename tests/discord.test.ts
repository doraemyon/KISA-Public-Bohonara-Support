import { afterEach, expect, it, vi } from "vitest";
import { discordSignupConfig, openWebhook } from "../src/discord-connection";
import { completeDiscordSignup, startDiscordSignup } from "../src/discord-signup";
import { discordNoticeMessage, handleDiscordCallback } from "../src/discord";
import { renderOnboardingPage } from "../src/onboarding";
import type { Env, TelegramCallbackQuery } from "../src/types";

const origin = "https://alerts.example.test";
const env = {
  PUBLIC_BASE_URL: origin, BOT_USERNAME: "KisaNoticeBot",
  DISCORD_CLIENT_ID: "123456789012345671",
  DISCORD_CLIENT_SECRET: "test-oauth-settings-secret",
  DISCORD_WEBHOOK_KEY: "ab".repeat(32),
  ADMIN_TELEGRAM_USER_ID: "100", TELEGRAM_BOT_TOKEN: "mock-telegram-token",
} as Env;
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

it("redeems a same-browser state once and stores only an encrypted webhook for review", async () => {
  const insert = vi.fn(async () => ({ meta: { changes: 1 } }));
  const consume = vi.fn().mockResolvedValueOnce({ applicant_name: "김하늘" }).mockResolvedValue(null);
  const bind = vi.fn(() => ({ first: consume, run: insert }));
  const live = { ...env, DB: { prepare: () => ({ bind }) } as unknown as D1Database };
  const start = await startDiscordSignup(new Request(origin + "/discord/subscribe"), live);
  expect(await start.text()).toContain('name="name"');
  expect(bind).not.toHaveBeenCalled();
  const go = await startDiscordSignup(new Request(origin + "/discord/subscribe", {
    method: "POST", headers: { Origin: origin },
    body: new URLSearchParams({ name: "김하늘" }),
  }), live);
  expect(go.status).toBe(303);
  const auth = new URL(go.headers.get("Location")!);
  expect(auth.origin).toBe("https://discord.com");
  expect(auth.searchParams.get("scope")).toBe("identify webhook.incoming");
  expect(auth.href).not.toContain(env.DISCORD_CLIENT_SECRET);
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

it("creates the notice buttons without pinging others", () => {
  const message = discordNoticeMessage(env, {
    title: "@everyone 보안 공지", link: "https://www.boho.or.kr/kr/bbs/view.do?nttId=72263", published_at: "2026-11-17",
  });
  const testMessage = discordNoticeMessage(env, {
    title: "보안 공지", link: "https://www.boho.or.kr/kr/bbs/view.do?nttId=72263", published_at: "",
  }, true);
  expect(testMessage.embeds[0].title).toBe("[연동 테스트] 보안 공지");
  expect(message.allowed_mentions).toEqual({ parse: [] });
  expect(message.components[0].components.map((button) => button.label)).toEqual(["공지 열기", "국문 공지", "영문 공지"]);
});

import { afterEach, expect, it, vi } from "vitest";

import { handleDiscordInteraction } from "../src/discord-applications";
import { discordConfig, isPrivateNoticeChannel } from "../src/discord-config";
import type { DiscordConfig } from "../src/discord-config";
import { deliverDiscordNotice, processDiscordNotices } from "../src/discord";
import { renderOnboardingPage } from "../src/onboarding";
import type { Env } from "../src/types";

const config: DiscordConfig = {
  applicationId: "123456789012345671",
  guildId: "123456789012345672",
  adminUserId: "123456789012345673",
  requestChannelId: "123456789012345674",
  noticeChannelId: "123456789012345675",
  subscriberRoleId: "123456789012345676",
  inviteUrl: "https://discord.gg/example-qrcode",
  publicKey: "a".repeat(64),
  botToken: "test-token.".repeat(5),
};
const env = {
  BOT_USERNAME: "KisaNoticeBot",
  PUBLIC_BASE_URL: "https://alerts.example.test",
  DISCORD_SUBSCRIPTION: JSON.stringify(config),
} as Env;
const article = {
  notice_id: "72298", title: "@everyone 제품 보안 업데이트 권고",
  link: "https://www.boho.or.kr/kr/bbs/view.do?bbsId=B0000133&nttId=72298",
  published_at: "2026-11-16", attempts: 0,
};

const privateChannel = {
  id: config.noticeChannelId, guild_id: config.guildId, type: 0,
  permission_overwrites: [
    { id: config.guildId, type: 0, allow: "0", deny: "1024" },
    { id: config.subscriberRoleId, type: 0, allow: "1024", deny: "2048" },
    { id: config.applicationId, type: 1, allow: "3072", deny: "0" },
  ],
};

afterEach(() => vi.unstubAllGlobals());

it("accepts only the configured role on the private alerts channel and validates the QR destination", () => {
  expect(isPrivateNoticeChannel(config, privateChannel)).toBe(true);
  expect(isPrivateNoticeChannel(config, { ...privateChannel, permission_overwrites: [] })).toBe(false);
  expect(isPrivateNoticeChannel(config, {
    ...privateChannel,
    permission_overwrites: [
      ...privateChannel.permission_overwrites,
      { id: "123456789012345677", type: 0, allow: "1024", deny: "0" },
    ],
  })).toBe(false);

  const html = renderOnboardingPage(env);
  expect(html).toContain('aria-label="Discord 가입 QR 코드"');
  expect(html).toContain(config.inviteUrl);
  expect(html).toContain('href="/notices/"');
  const invalid = { ...env, DISCORD_SUBSCRIPTION: JSON.stringify({ ...config, inviteUrl: "https://discord.gg.example.org/invite" }) };
  expect(discordConfig(invalid)).toBeNull();
  expect(renderOnboardingPage(invalid)).toContain("Discord 구독 신청은 연결 준비 중입니다.");
});

it("posts approved channel alerts with three document buttons and honors Discord rate limits", async () => {
  const send = vi.fn(async (_url: string, _options: RequestInit) => new Response(
    JSON.stringify({ retry_after: 61.3 }), { status: 429 },
  ));
  vi.stubGlobal("fetch", send);
  await processDiscordNotices({ ...env, DISCORD_SUBSCRIPTION: undefined }, "2026-11-16T00:01:00.000Z");
  expect(send).not.toHaveBeenCalled();

  expect(await deliverDiscordNotice(config, env, article))
    .toEqual({ sent: false, retrySeconds: 62, rateLimited: true });
  const [url, options] = send.mock.calls[0];
  expect(url).toBe("https://discord.com/api/v10/channels/" + config.noticeChannelId + "/messages");
  const payload = JSON.parse(String(options.body));
  expect(options.redirect).toBe("manual");
  expect(payload.allowed_mentions).toEqual({ parse: [] });
  expect(payload.components[0].components.map(({ label }: { label: string }) => label))
    .toEqual(["공지 열기", "국문 공지", "영문 공지"]);
});

it("authenticates Discord requests and allows only the specified administrator to grant access", async () => {
  const keys = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]) as CryptoKeyPair;
  const toHex = (data: ArrayBuffer) => Array.from(new Uint8Array(data), (v) => v.toString(16).padStart(2, "0")).join("");
  const publicKey = toHex(await crypto.subtle.exportKey("raw", keys.publicKey));
  const userId = "123456789012345677";
  const requestId = "123456789012345678";
  const interaction = {
    id: "123456789012345679", application_id: config.applicationId, guild_id: config.guildId,
    token: "sample-interaction-token", type: 3,
    data: { custom_id: ["sub", "approve", userId, requestId].join(":") },
  };
  const first = vi.fn(async () => ({ user_id: userId }));
  const run = vi.fn(async () => ({ meta: { changes: 1 } }));
  const bind = vi.fn(() => ({ first, run }));
  const activeEnv = {
    ...env,
    DISCORD_SUBSCRIPTION: JSON.stringify({ ...config, publicKey }),
    DB: { prepare: () => ({ bind }) } as unknown as D1Database,
  };
  const send = vi.fn(async (url: string, _options: RequestInit) => {
    if (url.endsWith("/channels/" + config.noticeChannelId)) return Response.json(privateChannel);
    if (url.endsWith("/roles/" + config.subscriberRoleId) && !url.includes("/members/")) {
      return Response.json({ id: config.subscriberRoleId, permissions: "0", managed: false });
    }
    return new Response(null, { status: 204 });
  });
  vi.stubGlobal("fetch", send);
  const background: Promise<unknown>[] = [];
  const ctx = { waitUntil: (promise: Promise<unknown>) => { background.push(promise); } } as unknown as ExecutionContext;
  const tap = async (actor: string, tamper = false) => {
    const body = JSON.stringify({ ...interaction, member: { user: { id: actor }, permissions: "268435456" } });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = toHex(await crypto.subtle.sign("Ed25519", keys.privateKey, new TextEncoder().encode(timestamp + body)));
    const request = new Request("https://alerts.example.test/discord/interactions", {
      method: "POST", body: tamper ? body + " " : body,
      headers: { "X-Signature-Ed25519": signature, "X-Signature-Timestamp": timestamp },
    });
    return handleDiscordInteraction(request, activeEnv, ctx);
  };

  expect((await tap(config.adminUserId, true)).status).toBe(401);
  expect(await (await tap(userId)).json()).toMatchObject({ type: 4, data: { flags: 64 } });
  expect(send).not.toHaveBeenCalled();
  expect(bind).not.toHaveBeenCalled();

  expect(await (await tap(config.adminUserId)).json()).toMatchObject({ type: 5, data: { flags: 64 } });
  await Promise.all(background);
  expect(send.mock.calls.map(([, options]) => options.method ?? "GET")).toEqual(["GET", "GET", "PUT", "PATCH"]);
  expect(send.mock.calls[2][0]).toContain("/members/" + userId + "/roles/" + config.subscriberRoleId);
  expect(bind).toHaveBeenCalledWith(config.guildId, userId, requestId);
});

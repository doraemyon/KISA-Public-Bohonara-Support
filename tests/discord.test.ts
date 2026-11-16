import { afterEach, expect, it, vi } from "vitest";

import { deliverDiscordNotice, discordWebhookEndpoint, processDiscordNotices } from "../src/discord";
import type { Env } from "../src/types";

const webhook = "https://discord.com/api/webhooks/123456789012345678/test-token";
const article = {
  notice_id: "72298",
  title: "@everyone 제품 보안 업데이트 권고",
  link: "https://www.boho.or.kr/kr/bbs/view.do?bbsId=B0000133&nttId=72298",
  published_at: "2026-11-16",
  attempts: 0,
};
const env = { PUBLIC_BASE_URL: "https://alerts.example.test" } as Env;

afterEach(() => vi.unstubAllGlobals());

it("only posts to a canonical Discord webhook and opts in to URL buttons", async () => {
  expect(discordWebhookEndpoint(webhook.replace("discord.com", "discord.com.example.test"))).toBeNull();
  expect(discordWebhookEndpoint(webhook + "?wait=false")).toBeNull();
  const endpoint = discordWebhookEndpoint(webhook)!;
  expect(endpoint.searchParams.get("wait")).toBe("true");
  expect(endpoint.searchParams.get("with_components")).toBe("true");
  const send = vi.fn(async (_url: URL, _options: RequestInit) => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", send);

  expect(await deliverDiscordNotice(endpoint, env, article)).toEqual({ sent: true });
  const [, options] = send.mock.calls[0];
  const payload = JSON.parse(String(options.body));
  expect(options.redirect).toBe("manual");
  expect(payload.allowed_mentions).toEqual({ parse: [] });
  expect(payload.components[0].components).toEqual([
    { type: 2, style: 5, label: "공지 열기", url: article.link },
    { type: 2, style: 5, label: "국문 공지", url: "https://alerts.example.test/notices/72298/ko/" },
    { type: 2, style: 5, label: "영문 공지", url: "https://alerts.example.test/notices/72298/en/" },
  ]);
});

it("uses Discord's retry window and never touches Discord when the secret is absent", async () => {
  const send = vi.fn(async () => new Response(JSON.stringify({ retry_after: 61.3 }), { status: 429 }));
  vi.stubGlobal("fetch", send);
  await processDiscordNotices(env, "2026-11-16T00:01:00.000Z");
  expect(send).not.toHaveBeenCalled();
  expect(await deliverDiscordNotice(discordWebhookEndpoint(webhook)!, env, article))
    .toEqual({ sent: false, retrySeconds: 62, rateLimited: true });
});

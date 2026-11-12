import { describe, expect, it } from "vitest";

import { renderOnboardingPage, telegramApplicationLink } from "../src/onboarding";
import type { Env } from "../src/types";

function environment(botUsername: string): Env {
  return { BOT_USERNAME: botUsername } as Env;
}

describe("onboarding page", () => {
  it("renders a local SVG QR for the Telegram application deep link", () => {
    const html = renderOnboardingPage(environment("KisaNoticeBot"));

    expect(html).toContain("https://t.me/KisaNoticeBot?start=apply");
    expect(html).toContain("<svg");
    expect(html).toContain("Telegram 봇 열기");
    expect(html).not.toContain("quickchart");
  });

  it("rejects an invalid bot username", () => {
    expect(() => telegramApplicationLink(environment("invalid bot"))).toThrow(
      "not a valid Telegram bot username",
    );
  });

  it("explains how to submit an account without exposing its configured prefix", () => {
    const html = renderOnboardingPage({
      ...environment("KisaNoticeBot"),
      APPLICATION_ACCOUNT_PREFIX: "xyz-private-test",
    });

    expect(html).toContain("/알림신청 계정명");
    expect(html).toContain("영문 2자_숫자 5자리");
    expect(html).not.toContain("xyz-private-test");
  });
});

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
});

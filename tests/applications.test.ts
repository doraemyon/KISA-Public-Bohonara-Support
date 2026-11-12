import { describe, expect, it, vi } from "vitest";

import * as applications from "../src/applications";
import {
  applicationDecisionLabel,
  parseApplicationCallback,
  parseSolutionAccount,
} from "../src/applications";
import worker from "../src/index";
import type { Env } from "../src/types";

describe("application approval helpers", () => {
  it("accepts only bounded approval callback data", () => {
    expect(parseApplicationCallback("application:account:approve:123456789")).toEqual({
      action: "approve",
      chatId: "123456789",
    });
    expect(parseApplicationCallback("application:account:reject:123456789")).toEqual({
      action: "reject",
      chatId: "123456789",
    });
    expect(parseApplicationCallback("application:account:approve:-1")).toBeNull();
    expect(parseApplicationCallback("application:account:admin:123")).toBeNull();
    expect(parseApplicationCallback("application:approve:123456789")).toBeNull();
  });

  it("provides a clear administrator result label", () => {
    expect(applicationDecisionLabel("approved")).toBe("승인 완료");
    expect(applicationDecisionLabel("full")).toBe("구독 인원 초과");
  });

  it("requires exactly one account with the configured prefix and five ASCII digits", () => {
    expect(parseSolutionAccount(["ZZ_01234"], "zz")).toBe("zz_01234");
    for (const args of [
      [],
      ["aa_01234"],
      ["zz_1234"],
      ["zz_123456"],
      ["zz_１２３４５"],
      ["zz_01234", "unexpected"],
    ]) {
      expect(parseSolutionAccount(args, "zz")).toBeNull();
    }
    expect(() => parseSolutionAccount(["zz_01234"], "")).toThrow("APPLICATION_ACCOUNT_PREFIX");
  });
});

describe("Telegram application messages", () => {
  it("queues a valid Korean command and silently discards invalid application messages", async () => {
    const env = {
      BOT_USERNAME: "KisaNoticeBot",
      TELEGRAM_WEBHOOK_SECRET: "test-webhook",
      ADMIN_TELEGRAM_USER_ID: "100",
      APPLICATION_ACCOUNT_PREFIX: "zz",
    } as Env;
    const submit = vi.spyOn(applications, "submitApplication").mockResolvedValue(true);
    const instructions = vi.spyOn(applications, "sendApplicationInstructions").mockResolvedValue();
    const send = (text: string) =>
      worker.fetch(
        new Request("https://example.test/telegram/webhook", {
          method: "POST",
          headers: { "X-Telegram-Bot-Api-Secret-Token": "test-webhook" },
          body: JSON.stringify({
            message: {
              message_id: 1,
              text,
              from: { id: 200 },
              chat: { id: 200, type: "private" },
            },
          }),
        }),
        env,
      );

    try {
      for (const text of ["/알림 신청 zz_01234", "/알림신청 aa_01234", "/알림신청 zz_1234"]) {
        expect((await send(text)).status).toBe(200);
      }
      expect(submit).not.toHaveBeenCalled();
      expect(instructions).not.toHaveBeenCalled();

      expect((await send("/알림신청 zz_01234")).status).toBe(200);
      expect((await send("/apply zz_01234")).status).toBe(200);
      expect(submit).toHaveBeenCalledTimes(2);
      expect(submit).toHaveBeenCalledWith(env, expect.any(Object), "zz_01234");
      expect(instructions).not.toHaveBeenCalled();
    } finally {
      submit.mockRestore();
      instructions.mockRestore();
    }
  });
});

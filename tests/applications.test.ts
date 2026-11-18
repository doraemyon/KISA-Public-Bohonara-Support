import { describe, expect, it, vi } from "vitest";

import * as applications from "../src/applications";
import {
  applicationDecisionLabel,
  parseApplicationCallback,
  parseApplicantName,
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

  it("accepts Korean and international names while rejecting the old account format", () => {
    expect(parseApplicantName(["이예원"])).toBe("이예원");
    expect(parseApplicantName(["Marie-Claire", "O’Connor"])).toBe("Marie-Claire O’Connor");
    expect(parseApplicantName(["Jose\u0301"])).toBe("José");
    for (const args of [
      [],
      ["이"],
      ["aa_01234"],
      ["홍길동", "123"],
      ["https://example.test"],
      ["이".repeat(49)],
    ]) {
      expect(parseApplicantName(args)).toBeNull();
    }
  });
});

describe("Telegram application messages", () => {
  it("queues valid commands and drops invalid or rate-limited signup attempts silently", async () => {
    const limit = vi.fn(async () => ({ success: true }));
    const prepare = vi.fn();
    const env = {
      TELEGRAM_SIGNUP_LIMITER: { limit },
      DB: { prepare } as unknown as D1Database,
      BOT_USERNAME: "KisaNoticeBot",
      TELEGRAM_WEBHOOK_SECRET: "test-webhook",
      ADMIN_TELEGRAM_USER_ID: "100",
    } as Partial<Env> as Env;
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
        {} as ExecutionContext,
      );

    try {
      for (const text of ["/알림 신청 이예원", "/알림신청 aa_01234", "/알림신청 1234"]) {
        expect((await send(text)).status).toBe(200);
      }
      expect(submit).not.toHaveBeenCalled();
      expect(instructions).not.toHaveBeenCalled();

      expect((await send("/알림신청 이예원")).status).toBe(200);
      expect((await send("/apply 이예원")).status).toBe(200);
      expect(submit).toHaveBeenCalledTimes(2);
      expect(submit).toHaveBeenCalledWith(env, expect.any(Object), "이예원");
      expect(instructions).not.toHaveBeenCalled();
      expect(limit).toHaveBeenCalledTimes(4);
      expect(limit).toHaveBeenCalledWith({ key: "200" });

      limit.mockClear();
      limit.mockResolvedValue({ success: false });
      for (const text of ["/알림신청 이예원", "/apply 이예원", "/start apply", "/start test-invite"]) {
        const result = await send(text);
        expect(result.status).toBe(200);
        expect(await result.json()).toEqual({ ok: true });
      }
      expect(limit).toHaveBeenCalledTimes(4);
      expect(submit).toHaveBeenCalledTimes(2);
      expect(instructions).not.toHaveBeenCalled();
      expect(prepare).not.toHaveBeenCalled();
    } finally {
      submit.mockRestore();
      instructions.mockRestore();
    }
  });
});

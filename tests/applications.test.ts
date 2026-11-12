import { describe, expect, it } from "vitest";

import {
  applicationDecisionLabel,
  parseApplicationCallback,
  parseSolutionAccount,
} from "../src/applications";

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

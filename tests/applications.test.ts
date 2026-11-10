import { describe, expect, it } from "vitest";

import {
  applicationDecisionLabel,
  parseApplicationCallback,
} from "../src/applications";

describe("application approval helpers", () => {
  it("accepts only bounded approval callback data", () => {
    expect(parseApplicationCallback("application:approve:123456789")).toEqual({
      action: "approve",
      chatId: "123456789",
    });
    expect(parseApplicationCallback("application:reject:123456789")).toEqual({
      action: "reject",
      chatId: "123456789",
    });
    expect(parseApplicationCallback("application:approve:-1")).toBeNull();
    expect(parseApplicationCallback("application:admin:123")).toBeNull();
  });

  it("provides a clear administrator result label", () => {
    expect(applicationDecisionLabel("approved")).toBe("승인 완료");
    expect(applicationDecisionLabel("full")).toBe("구독 인원 초과");
  });
});

import { describe, expect, it } from "vitest";

import {
  parseCommand,
  parseInviteRequest,
  randomInviteCode,
  sha256,
} from "../src/access";

describe("access control helpers", () => {
  it("parses commands addressed to this bot", () => {
    expect(parseCommand("/invite@KisaTeamBot 2 7", "KisaTeamBot")).toEqual({
      name: "invite",
      args: ["2", "7"],
    });
    expect(parseCommand("/start code", "KisaTeamBot")).toEqual({
      name: "start",
      args: ["code"],
    });
  });

  it("ignores commands addressed to another bot", () => {
    expect(parseCommand("/start@AnotherBot code", "KisaTeamBot")).toBeNull();
  });

  it("enforces invite usage and expiry bounds", () => {
    expect(parseInviteRequest([])).toEqual({ maxUses: 1, validDays: 7 });
    expect(parseInviteRequest(["20", "30"])).toEqual({
      maxUses: 20,
      validDays: 30,
    });
    expect(parseInviteRequest(["21", "7"])).toBeNull();
    expect(parseInviteRequest(["1", "31"])).toBeNull();
    expect(parseInviteRequest(["1회", "7일"])).toBeNull();
  });

  it("creates Telegram-safe random codes and hashes them", async () => {
    const first = randomInviteCode();
    const second = randomInviteCode();

    expect(first).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(second).not.toBe(first);
    expect(await sha256(first)).toMatch(/^[a-f0-9]{64}$/);
  });
});

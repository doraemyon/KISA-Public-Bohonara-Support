import { describe, expect, it } from "vitest";

import { boundedInteger } from "../src/config";

describe("bounded configuration", () => {
  it("accepts values inside the configured range", () => {
    expect(boundedInteger("20", 10, 1, 20)).toBe(20);
  });

  it("falls back for malformed or unsafe values", () => {
    expect(boundedInteger("0", 10, 1, 20)).toBe(10);
    expect(boundedInteger("999", 10, 1, 20)).toBe(10);
    expect(boundedInteger("not-a-number", 10, 1, 20)).toBe(10);
    expect(boundedInteger("20items", 10, 1, 20)).toBe(10);
  });
});

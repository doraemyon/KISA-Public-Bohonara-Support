import { describe, expect, it } from "vitest";

import {
  adminNotificationBatchSize,
  boundedInteger,
  maxApplicationsPerHour,
  maxPendingApplications,
} from "../src/config";
import type { Env } from "../src/types";

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

  it("keeps application and administrator notification limits bounded", () => {
    const env = {
      MAX_PENDING_APPLICATIONS: "200",
      MAX_APPLICATIONS_PER_HOUR: "30",
      ADMIN_NOTIFICATION_BATCH_SIZE: "99",
    } as Env;
    expect(maxPendingApplications(env)).toBe(200);
    expect(maxApplicationsPerHour(env)).toBe(30);
    expect(adminNotificationBatchSize(env)).toBe(5);
  });
});

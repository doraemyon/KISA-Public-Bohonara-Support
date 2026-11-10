import type { Env } from "./types";

export function required(value: string | undefined, name: string): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    throw new Error(`Missing required configuration: ${name}`);
  }
  return normalized;
}

export function boundedInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const normalized = value?.trim();
  if (!normalized || !/^\d+$/.test(normalized)) return fallback;
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    return fallback;
  }
  return parsed;
}

export function maxSubscribers(env: Env): number {
  return boundedInteger(env.MAX_SUBSCRIBERS, 50, 1, 500);
}

export function broadcastBatchSize(env: Env): number {
  // One scheduled invocation also fetches the RSS feed. Keeping this at 20
  // stays comfortably under Telegram's free limit and Workers subrequest cap.
  return boundedInteger(env.BROADCAST_BATCH_SIZE, 20, 1, 20);
}

export function maxPendingApplications(env: Env): number {
  return boundedInteger(env.MAX_PENDING_APPLICATIONS, 100, 1, 500);
}

export function maxApplicationsPerHour(env: Env): number {
  return boundedInteger(env.MAX_APPLICATIONS_PER_HOUR, 20, 1, 60);
}

export function adminNotificationBatchSize(env: Env): number {
  // Notice delivery is capped at 20. Five application notifications keep the
  // scheduled burst below Telegram's approximate 30 messages/second ceiling.
  return boundedInteger(env.ADMIN_NOTIFICATION_BATCH_SIZE, 5, 1, 5);
}

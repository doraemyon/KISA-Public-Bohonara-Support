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

import { publicSiteUrl } from "./config";
import type { Env } from "./types";

export const DISCORD_AUTH_PATH = "/discord/subscribe";
export const DISCORD_RESUME_PATH = "/discord/subscribe/resume";
export const DISCORD_NAME_PATH = "/discord/subscribe/name";
export const DISCORD_CALLBACK_PATH = "/discord/callback";
export const DISCORD_ORIGIN = "https://discord.com";

export interface DiscordWebhook {
  id: string;
  token: string;
  channel_id: string;
}

export function discordSignupConfig(env: Env) {
  const site = publicSiteUrl(env);
  if (!site || !discordId(env.DISCORD_CLIENT_ID) ||
      !env.DISCORD_CLIENT_SECRET || !/^[\w.-]{16,256}$/.test(env.DISCORD_CLIENT_SECRET) ||
      !env.DISCORD_WEBHOOK_KEY || !/^[a-f0-9]{64}$/i.test(env.DISCORD_WEBHOOK_KEY)) return null;
  return {
    clientId: env.DISCORD_CLIENT_ID,
    clientSecret: env.DISCORD_CLIENT_SECRET,
    key: env.DISCORD_WEBHOOK_KEY,
    redirect: new URL(DISCORD_CALLBACK_PATH, site).href,
  };
}

export function discordId(value: unknown): value is string {
  return typeof value === "string" && /^\d{17,20}$/.test(value);
}

export function isDiscordWebhook(value: unknown): value is DiscordWebhook {
  if (!value || typeof value !== "object") return false;
  const hook = value as Partial<DiscordWebhook>;
  return discordId(hook.id) && discordId(hook.channel_id) &&
    typeof hook.token === "string" && /^[\w.-]{16,256}$/.test(hook.token);
}

export function discordApi(path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(DISCORD_ORIGIN + "/api/v10" + path, {
    ...options, redirect: "manual", signal: AbortSignal.timeout(7000),
  });
}

export function webhookPath(hook: DiscordWebhook): string {
  return "/webhooks/" + hook.id + "/" + hook.token;
}

export async function removeWebhook(hook: DiscordWebhook): Promise<boolean> {
  try {
    const response = await discordApi(webhookPath(hook), { method: "DELETE" });
    await response.body?.cancel().catch(() => {});
    return response.ok || [401, 403, 404].includes(response.status);
  } catch {
    return false;
  }
}

export const toHex = (data: Uint8Array) => Array.from(data, (byte) => byte.toString(16).padStart(2, "0")).join("");
function fromHex(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(value.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
}

async function sealDiscordData(value: string, secret: string, context?: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", fromHex(secret), "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const additionalData = context === undefined ? undefined : encoder.encode(context);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData }, key, encoder.encode(value));
  return toHex(iv) + ":" + toHex(new Uint8Array(encrypted));
}

async function openDiscordData(value: string, secret: string, context?: string): Promise<string> {
  const [iv, ciphertext] = value.split(":");
  const key = await crypto.subtle.importKey("raw", fromHex(secret), "AES-GCM", false, ["decrypt"]);
  const additionalData = context === undefined ? undefined : new TextEncoder().encode(context);
  const bytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromHex(iv), additionalData }, key, fromHex(ciphertext));
  return new TextDecoder().decode(bytes);
}

export function sealDiscordCallbackCode(code: string, secret: string, hash: string): Promise<string> {
  return sealDiscordData(code, secret, "discord-oauth-callback:" + hash);
}

export function openDiscordCallbackCode(value: string, secret: string, hash: string): Promise<string> {
  return openDiscordData(value, secret, "discord-oauth-callback:" + hash);
}

export function sealWebhook(hook: DiscordWebhook, secret: string): Promise<string> {
  return sealDiscordData(JSON.stringify({ id: hook.id, token: hook.token, channel_id: hook.channel_id }), secret);
}

export async function openWebhook(value: string, secret: string): Promise<DiscordWebhook> {
  const decoded: unknown = JSON.parse(await openDiscordData(value, secret));
  if (!isDiscordWebhook(decoded)) throw new Error("Invalid stored Discord webhook");
  return decoded;
}

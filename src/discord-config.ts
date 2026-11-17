import { httpsUrl } from "./config";
import type { Env } from "./types";

export const MANAGE_ROLES = 1n << 28n;
const ADMINISTRATOR = 1n << 3n;
const VIEW_CHANNEL = 1n << 10n;
const SEND_MESSAGES = 1n << 11n;

export const discordId = (value: unknown): value is string =>
  typeof value === "string" && /^\d{17,20}$/.test(value);

export interface DiscordConfig {
  applicationId: string;
  publicKey: string;
  adminUserId: string;
  guildId: string;
  requestChannelId: string;
  noticeChannelId: string;
  subscriberRoleId: string;
  inviteUrl: string;
  botToken: string;
}

function inviteUrl(value: unknown): string | null {
  const url = httpsUrl(typeof value === "string" ? value : undefined);
  if (!url) return null;
  if (url.origin === "https://discord.gg" && /^\/[\w-]{2,64}$/.test(url.pathname)) return url.href;
  if (url.origin === "https://discord.com" && /^\/invite\/[\w-]{2,64}$/.test(url.pathname)) return url.href;
  return null;
}

export function discordConfig(env: Env): DiscordConfig | null {
  if (!env.DISCORD_SUBSCRIPTION) return null;
  try {
    const value = JSON.parse(env.DISCORD_SUBSCRIPTION);
    const { applicationId, publicKey, adminUserId, guildId, requestChannelId, noticeChannelId, subscriberRoleId, botToken } = value;
    const invite = inviteUrl(value.inviteUrl);
    if (!discordId(applicationId) || !discordId(adminUserId) || !discordId(guildId) || !discordId(requestChannelId) ||
        !discordId(noticeChannelId) || !discordId(subscriberRoleId) || !invite ||
        guildId === subscriberRoleId || requestChannelId === noticeChannelId ||
        typeof publicKey !== "string" || !/^[a-f0-9]{64}$/i.test(publicKey) ||
        typeof botToken !== "string" || !/^[\w.-]{30,200}$/.test(botToken)) return null;
    return { applicationId, publicKey, adminUserId, guildId, requestChannelId, noticeChannelId, subscriberRoleId, inviteUrl: invite, botToken };
  } catch {
    return null;
  }
}

export function managesDiscordRoles(value: unknown): boolean {
  return (permissionBits(value) & (MANAGE_ROLES | ADMINISTRATOR)) !== 0n;
}

function permissionBits(value: unknown): bigint {
  return typeof value === "string" && /^\d{1,32}$/.test(value) ? BigInt(value) : 0n;
}

export function isPrivateNoticeChannel(config: DiscordConfig, value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const channel = value as {
    id?: string; guild_id?: string; type?: number;
    permission_overwrites?: { id: string; type: number; allow: string; deny: string }[];
  };
  const overwrites = channel.permission_overwrites;
  if (channel.id !== config.noticeChannelId || channel.guild_id !== config.guildId ||
      channel.type !== 0 || !Array.isArray(overwrites)) return false;

  const everyone = overwrites.find(({ id, type }) => id === config.guildId && type === 0);
  const subscribers = overwrites.find(({ id, type }) => id === config.subscriberRoleId && type === 0);
  if (!everyone || (permissionBits(everyone.deny) & VIEW_CHANNEL) === 0n ||
      !subscribers || (permissionBits(subscribers.allow) & VIEW_CHANNEL) === 0n ||
      (permissionBits(subscribers.deny) & SEND_MESSAGES) === 0n) return false;
  return overwrites.every(({ id, type, allow }) => {
    const bits = permissionBits(allow);
    if (id === config.subscriberRoleId && type === 0) return (bits & SEND_MESSAGES) === 0n;
    if (id === config.applicationId && type === 1) return true;
    return (bits & VIEW_CHANNEL) === 0n;
  });
}

export function discordApi(path: string, options: RequestInit, token?: string): Promise<Response> {
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", "Bot " + token);
  if (options.body) headers.set("Content-Type", "application/json");
  return fetch("https://discord.com/api/v10" + path, {
    ...options, headers, redirect: "manual", signal: AbortSignal.timeout(6500),
  });
}

export async function approvedNoticeChannel(config: DiscordConfig): Promise<boolean> {
  const response = await discordApi("/channels/" + config.noticeChannelId, {}, config.botToken);
  if (!response.ok) return false;
  if (!isPrivateNoticeChannel(config, await response.json())) return false;
  const roleResponse = await discordApi("/guilds/" + config.guildId + "/roles/" + config.subscriberRoleId, {}, config.botToken);
  if (!roleResponse.ok) return false;
  const role = await roleResponse.json<{ id?: string; managed?: boolean; permissions?: string }>();
  return role.id === config.subscriberRoleId && role.managed === false && role.permissions === "0";
}

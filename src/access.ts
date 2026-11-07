export interface ParsedCommand {
  name: string;
  args: string[];
}

export interface InviteRequest {
  maxUses: number;
  validDays: number;
}

export function parseCommand(text: string, botUsername: string): ParsedCommand | null {
  const normalized = text.trim();
  if (!normalized.startsWith("/")) return null;
  const [rawName, ...args] = normalized.split(/\s+/);
  const [command, addressedBot] = rawName.slice(1).split("@", 2);
  if (addressedBot && addressedBot.toLowerCase() !== botUsername.toLowerCase()) {
    return null;
  }
  return { name: command.toLowerCase(), args };
}

export function parseInviteRequest(args: string[]): InviteRequest | null {
  const rawMaxUses = args[0] ?? "1";
  const rawValidDays = args[1] ?? "7";
  if (!/^\d+$/.test(rawMaxUses) || !/^\d+$/.test(rawValidDays)) return null;
  const maxUses = Number.parseInt(rawMaxUses, 10);
  const validDays = Number.parseInt(rawValidDays, 10);
  if (
    !Number.isSafeInteger(maxUses) ||
    maxUses < 1 ||
    maxUses > 20 ||
    !Number.isSafeInteger(validDays) ||
    validDays < 1 ||
    validDays > 30
  ) {
    return null;
  }
  return { maxUses, validDays };
}

export function randomInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

import { parseApplicantName } from "./applications";
import { maxApplicationsPerHour, maxPendingApplications } from "./config";
import { approvedNoticeChannel, discordApi, discordConfig, discordId, managesDiscordRoles } from "./discord-config";
import type { DiscordConfig } from "./discord-config";
import type { Env } from "./types";

type Interaction = {
  id: string;
  type: number;
  application_id: string;
  guild_id?: string;
  channel_id?: string;
  channel?: { id?: string };
  member?: { user?: { id?: string }; roles?: string[]; permissions?: string };
  token: string;
  data?: { name?: string; options?: { name: string; value: unknown }[]; custom_id?: string };
};

type Message = { content: string; allowed_mentions: { parse: [] }; components?: unknown[] };

function message(content: string, components?: unknown[]): Message {
  return { content, allowed_mentions: { parse: [] }, components };
}

function reply(content: string): Response {
  return Response.json({ type: 4, data: { ...message(content), flags: 64 } });
}

function hex(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(value.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
}

async function verifiedInteraction(request: Request, config: DiscordConfig): Promise<Interaction | null> {
  try {
    const timestamp = request.headers.get("X-Signature-Timestamp") ?? "";
    const signature = request.headers.get("X-Signature-Ed25519") ?? "";
    if (!/^\d{10}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
        !/^[a-f0-9]{128}$/i.test(signature)) return null;
    const reader = request.body?.getReader();
    if (!reader) return null;
    const prefix = new TextEncoder().encode(timestamp);
    const bytes = new Uint8Array(65_536 + prefix.length);
    bytes.set(prefix);
    let length = prefix.length;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (length + value.length > bytes.length) {
        await reader.cancel();
        return null;
      }
      bytes.set(value, length);
      length += value.length;
    }
    const key = await crypto.subtle.importKey("raw", hex(config.publicKey), "Ed25519", false, ["verify"]);
    if (!await crypto.subtle.verify("Ed25519", key, hex(signature), bytes.subarray(0, length))) return null;
    const json = JSON.parse(new TextDecoder().decode(bytes.subarray(prefix.length, length)));
    return json?.application_id === config.applicationId ? json : null;
  } catch {
    return null;
  }
}

async function submit(env: Env, config: DiscordConfig, interaction: Interaction, userId: string): Promise<Message> {
  if ((interaction.channel?.id ?? interaction.channel_id) !== config.requestChannelId) {
    return message("가입 신청은 <#" + config.requestChannelId + "> 채널에서 할 수 있습니다.");
  }
  if (interaction.member?.roles?.includes(config.subscriberRoleId)) return message("이미 알림을 구독하고 있습니다.");
  const input = interaction.data?.options?.find(({ name }) => name === "성명")?.value;
  const name = typeof input === "string" ? parseApplicantName(input.trim().split(/\s+/)) : null;
  if (!name) return message("본인의 성명을 입력해 주세요.");

  const now = new Date();
  const recent = new Date(now.getTime() - 3_600_000).toISOString();
  const result = await env.DB.prepare(
    "INSERT INTO discord_applications (guild_id, user_id, request_id, name, requested_at) " +
    "SELECT ?1, ?2, ?3, ?4, ?5 " +
    "WHERE (SELECT COUNT(*) FROM discord_applications WHERE guild_id = ?1) < ?6 " +
    "AND (SELECT COUNT(*) FROM discord_applications WHERE guild_id = ?1 AND requested_at >= ?7) < ?8 " +
    "ON CONFLICT (guild_id, user_id) DO NOTHING",
  ).bind(config.guildId, userId, interaction.id, name, now.toISOString(),
    maxPendingApplications(env), recent, maxApplicationsPerHour(env)).run();
  if (result.meta.changes === 1) return message("구독 신청을 접수했습니다. 관리자가 승인하면 알림 채널이 표시됩니다.");
  const exists = await env.DB.prepare(
    "SELECT 1 FROM discord_applications WHERE guild_id = ?1 AND user_id = ?2",
  ).bind(config.guildId, userId).first();
  return message(exists ? "이미 접수된 신청이 있습니다. 관리자 승인을 기다려 주세요." : "신청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.");
}

async function pending(env: Env, config: DiscordConfig): Promise<Message> {
  const result = await env.DB.prepare(
    "SELECT user_id, request_id, name, approving FROM discord_applications WHERE guild_id = ?1 ORDER BY requested_at LIMIT 5",
  ).bind(config.guildId).all<{ user_id: string; request_id: string; name: string; approving: number }>();
  if (result.results.length === 0) return message("승인 대기 중인 신청이 없습니다.");
  const content = ["**Discord 알림 구독 신청**"];
  const rows = result.results.map((row, index) => {
    const number = index + 1;
    content.push(number + ". " + row.name + " · <@" + row.user_id + ">");
    const button = (action: "approve" | "reject", label: string, style: number) => ({
      type: 2, style, label: label + " " + number,
      custom_id: "sub:" + action + ":" + row.user_id + ":" + row.request_id,
    });
    const components = row.approving
      ? [button("approve", "승인 재시도", 3)]
      : [button("approve", "승인", 3), button("reject", "거절", 4)];
    return { type: 1, components };
  });
  content.push("처리 후 /알림관리로 다음 신청을 확인하세요.");
  return message(content.join("\n"), rows);
}

async function decide(env: Env, config: DiscordConfig, action: string, userId: string, requestId: string): Promise<Message> {
  const remove = (pendingOnly: boolean) => env.DB.prepare(
    "DELETE FROM discord_applications WHERE guild_id = ?1 AND user_id = ?2 AND request_id = ?3" +
    (pendingOnly ? " AND approving = 0" : ""),
  ).bind(config.guildId, userId, requestId).run();

  if (action === "reject") {
    const result = await remove(true);
    return message(result.meta.changes === 1 ? "신청을 거절했습니다." : "이미 처리됐거나 승인 중인 신청입니다.");
  }

  if (!await approvedNoticeChannel(config)) {
    return message("알림 채널의 비공개 권한을 확인한 후 /알림관리에서 다시 승인해 주세요.");
  }
  const claim = await env.DB.prepare(
    "UPDATE discord_applications SET approving = 1 WHERE guild_id = ?1 AND user_id = ?2 AND request_id = ?3 RETURNING user_id",
  ).bind(config.guildId, userId, requestId).first();
  if (!claim) return message("이미 처리된 신청입니다.");
  const response = await discordApi(
    "/guilds/" + config.guildId + "/members/" + userId + "/roles/" + config.subscriberRoleId,
    { method: "PUT" }, config.botToken,
  );
  if (response.status === 404) {
    const error = await response.json<{ code?: number }>().catch(() => null);
    if (error?.code === 10007) {
      await remove(false);
      return message("신청자가 서버를 나가 신청을 정리했습니다.");
    }
  }
  if (!response.ok) return message("역할을 부여하지 못했습니다. 봇의 역할 관리 권한과 역할 순서를 확인한 뒤 다시 승인해 주세요.");
  await remove(false);
  return message("신청을 승인했습니다. 신청자가 알림 채널을 볼 수 있습니다.");
}

async function finish(config: DiscordConfig, interaction: Interaction, work: () => Promise<Message>): Promise<void> {
  let result: Message;
  try {
    result = await work();
  } catch {
    console.error("Discord subscription operation failed.", interaction.id);
    result = message("처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
  }
  try {
    const response = await discordApi(
      "/webhooks/" + config.applicationId + "/" + interaction.token + "/messages/@original",
      { method: "PATCH", body: JSON.stringify(result) },
    );
    if (!response.ok) console.error("Discord response failed.", response.status, interaction.id);
  } catch {
    console.error("Discord response could not be delivered.", interaction.id);
  }
}

export async function handleDiscordInteraction(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const config = discordConfig(env);
  if (!config) return new Response(null, { status: 503 });
  const interaction = await verifiedInteraction(request, config);
  if (!interaction) return new Response(null, { status: 401 });
  if (interaction.type === 1) return Response.json({ type: 1 });

  const userId = interaction.member?.user?.id;
  if (interaction.guild_id !== config.guildId || !discordId(userId) || !discordId(interaction.id) ||
      typeof interaction.token !== "string" || !/^[\w.-]{16,1024}$/.test(interaction.token)) {
    return reply("등록된 Discord 서버에서 이용할 수 있습니다.");
  }
  let work: () => Promise<Message>;
  if (interaction.type === 2 && interaction.data?.name === "알림신청") {
    work = () => submit(env, config, interaction, userId);
  } else {
    if (userId !== config.adminUserId || !managesDiscordRoles(interaction.member?.permissions)) return reply("알림 관리 권한이 필요합니다.");
    if (interaction.type === 2 && interaction.data?.name === "알림관리") {
      work = () => pending(env, config);
    } else {
      const match = /^sub:(approve|reject):(\d{17,20}):(\d{17,20})$/.exec(interaction.data?.custom_id ?? "");
      if (interaction.type !== 3 || !match) return reply("지원하지 않는 요청입니다.");
      work = () => decide(env, config, match[1], match[2], match[3]);
    }
  }
  ctx.waitUntil(finish(config, interaction, work));
  return Response.json({ type: 5, data: { flags: 64 } });
}

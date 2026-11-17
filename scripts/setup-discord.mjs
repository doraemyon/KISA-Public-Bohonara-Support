import { spawnSync } from "node:child_process";

async function main() {
  let raw = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) raw += chunk;
  let config;
  try {
    config = JSON.parse(raw);
  } catch {
    throw new Error("JSON 설정을 표준 입력으로 전달하세요.");
  }
  const { applicationId, publicKey, adminUserId, guildId, requestChannelId, noticeChannelId, subscriberRoleId, inviteUrl, botToken } = config;
  if (![applicationId, adminUserId, guildId, requestChannelId, noticeChannelId, subscriberRoleId].every((id) => /^\d{17,20}$/.test(id)) ||
      !/^[a-f0-9]{64}$/i.test(publicKey) || !/^[\w.-]{30,200}$/.test(botToken) ||
      requestChannelId === noticeChannelId || guildId === subscriberRoleId) {
    throw new Error("Application ID, Public Key, Discord ID, Bot Token을 확인하세요.");
  }
  const match = /^https:\/\/(?:discord\.gg\/|discord\.com\/invite\/)([\w-]{2,64})$/.exec(inviteUrl);
  if (!match) throw new Error("Discord에서 만든 가입 신청 채널 초대 링크를 사용하세요.");
  const api = "https://discord.com/api/v10";
  const invite = await fetch(api + "/invites/" + match[1], { signal: AbortSignal.timeout(8000) });
  if (!invite.ok) throw new Error("Discord 초대 링크를 확인할 수 없습니다. 만료 여부를 확인하세요.");
  const destination = await invite.json();
  if (destination.guild?.id !== guildId || destination.channel?.id !== requestChannelId) {
    throw new Error("초대 링크의 서버와 가입 신청 채널을 확인하세요.");
  }

  const options = { headers: { Authorization: "Bot " + botToken, "Content-Type": "application/json" }, signal: AbortSignal.timeout(8000) };
  const channelResponse = await fetch(api + "/channels/" + noticeChannelId, options);
  if (!channelResponse.ok) throw new Error("봇이 보안공지 채널을 읽을 수 없습니다. 봇의 채널 권한을 확인하세요.");
  const channel = await channelResponse.json();
  if (channel.guild_id !== guildId || channel.type !== 0) throw new Error("알림은 설정한 서버의 일반 텍스트 채널이어야 합니다.");
  const permissions = channel.permission_overwrites ?? [];
  const canView = (bits) => (BigInt(bits ?? "0") & 1024n) !== 0n;
  const canSend = (bits) => (BigInt(bits ?? "0") & 2048n) !== 0n;
  if (!permissions.some(({ id, type, deny }) => id === guildId && type === 0 && canView(deny)) ||
      !permissions.some(({ id, type, allow, deny }) => id === subscriberRoleId && type === 0 && canView(allow) && !canSend(allow) && canSend(deny)) ||
      permissions.some(({ id, type, allow }) => canView(allow) &&
        !(id === subscriberRoleId && type === 0) && !(id === applicationId && type === 1))) {
    throw new Error("알림 채널은 @everyone에게 숨기고, 구독자 역할과 봇 계정에만 채널 보기를 허용하세요.");
  }

  const roleResponse = await fetch(api + "/guilds/" + guildId + "/roles/" + subscriberRoleId, options);
  if (!roleResponse.ok) throw new Error("공지 구독자 역할을 읽을 수 없습니다.");
  const role = await roleResponse.json();
  if (role.managed !== false || role.permissions !== "0") throw new Error("서버 권한이 없는 일반 역할을 구독자 역할로 지정하세요.");

  const commands = [
    {
      name: "알림신청",
      description: "KISA 보안공지 Discord 알림을 신청합니다.",
      options: [{ type: 3, name: "성명", description: "관리자가 확인할 본인의 성명", required: true, max_length: 48 }],
    },
    {
      name: "알림관리",
      description: "대기 중인 구독 신청을 비공개로 검토합니다.",
      default_member_permissions: "268435456",
    },
  ];
  for (const command of commands) {
    const response = await fetch(api + "/applications/" + applicationId + "/guilds/" + guildId + "/commands", {
      ...options, method: "POST", body: JSON.stringify(command), signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error("Discord 명령 등록 실패 (HTTP " + response.status + ").");
  }

  const wrangler = spawnSync(process.execPath, [
    "node_modules/wrangler/bin/wrangler.js", "secret", "put", "DISCORD_SUBSCRIPTION",
    "--config", process.argv[2] ?? ".wrangler/deploy.jsonc",
  ], { input: JSON.stringify(config), encoding: "utf8" });
  if (wrangler.status !== 0) throw new Error("Cloudflare Secret 등록 실패. Wrangler 로그인과 Worker 설정을 확인하세요.");
  console.log("Discord 명령과 Worker Secret을 등록했습니다. Discord Developer Portal에서 Interactions Endpoint URL을 저장하세요.");
}

main().catch((error) => {
  if (error.name === "TypeError" || error.name === "TimeoutError") {
    console.error("Discord API에 연결하지 못했습니다. 잠시 후 다시 시도하세요.");
  } else {
    console.error(error.message);
  }
  process.exitCode = 1;
});

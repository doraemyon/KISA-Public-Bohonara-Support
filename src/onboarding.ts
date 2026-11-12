import { APPLICATION_COMMAND } from "./access";
import { required } from "./config";
import { renderTelegramQr } from "./telegram-qr";
import type { Env } from "./types";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function telegramApplicationLink(env: Env): string {
  const username = required(env.BOT_USERNAME, "BOT_USERNAME").replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{5,32}$/.test(username)) {
    throw new Error("BOT_USERNAME is not a valid Telegram bot username.");
  }
  return `https://t.me/${username}?start=apply`;
}

export function renderOnboardingPage(env: Env): string {
  const botLink = telegramApplicationLink(env);
  const botUsername = new URL(botLink).pathname.slice(1);
  const qr = renderTelegramQr(botLink);
  const safeBotLink = escapeHtml(botLink);
  const safeBotUsername = escapeHtml(botUsername);

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="index,follow">
  <meta name="description" content="KISA 보호나라 보안공지를 Telegram으로 받아보는 승인형 알림 서비스">
  <title>KISA 보안공지 Telegram 알림 신청</title>
  <style>
    :root { color-scheme: dark; font-family: -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif; --bg:#0d1117; --panel:#161b22; --panel-2:#21262d; --border:#30363d; --text:#f0f6fc; --muted:#8b949e; --blue:#2f81f7; --green:#238636; }
    * { box-sizing: border-box; }
    body { min-width:320px; min-height:100vh; margin:0; background:var(--bg); color:var(--text); }
    a { color:inherit; }
    .topbar { border-bottom:1px solid var(--border); background:#010409; }
    .topbar__inner { display:flex; width:min(100% - 32px,1040px); min-height:60px; margin:0 auto; align-items:center; justify-content:space-between; gap:16px; }
    .brand { font-size:14px; font-weight:600; letter-spacing:-.01em; text-decoration:none; }
    .repo { color:var(--muted); font-size:12px; text-decoration:none; }
    .repo:hover { color:var(--blue); text-decoration:underline; text-underline-offset:3px; }
    main { width:min(100% - 32px,1040px); margin:0 auto; padding:64px 0 72px; }
    .layout { display:grid; grid-template-columns:minmax(0,1fr) 380px; align-items:center; gap:72px; }
    .eyebrow { margin:0 0 12px; color:#58a6ff; font-size:13px; font-weight:600; }
    h1 { max-width:650px; margin:0; font-size:clamp(34px,5.2vw,56px); line-height:1.12; letter-spacing:-.045em; }
    .lead { max-width:620px; margin:20px 0 0; color:var(--muted); font-size:17px; line-height:1.7; }
    .steps-title { margin:32px 0 12px; font-size:16px; }
    .steps { display:grid; margin:0; padding:0; gap:16px; list-style:none; }
    .step { display:grid; grid-template-columns:28px minmax(0,1fr); align-items:start; gap:12px; }
    .step__number { display:grid; width:28px; height:28px; place-items:center; border:1px solid var(--border); border-radius:50%; background:var(--panel); color:var(--text); font-size:12px; font-weight:600; line-height:1; font-variant-numeric:tabular-nums; }
    .step__title { display:block; margin:0 0 2px; font-size:14px; line-height:28px; }
    .step__detail { margin:0; color:var(--muted); font-size:13px; line-height:1.65; }
    .step__detail strong { color:var(--text); }
    .step__command { display:inline-block; max-width:100%; margin:9px 0 7px; padding:7px 11px; border:1px solid var(--border); border-radius:6px; background:var(--panel); color:#e6edf3; font:600 14px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace; overflow-wrap:anywhere; }
    .card { padding:24px; border:1px solid var(--border); border-radius:8px; background:var(--panel); box-shadow:0 16px 48px rgba(1,4,9,.35); }
    .qr { width:100%; aspect-ratio:1; overflow:hidden; border-radius:12px; background:#fff; }
    .qr svg { display:block; width:100%; height:100%; }
    .card h2 { margin:20px 0 6px; font-size:18px; letter-spacing:-.02em; }
    .handle { margin:0 0 18px; color:var(--muted); font:13px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace; }
    .button { display:flex; min-height:44px; padding:9px 16px; align-items:center; justify-content:center; border:1px solid rgba(240,246,252,.1); border-radius:6px; background:var(--green); color:#fff; font-size:14px; font-weight:600; text-decoration:none; }
    .button:hover { background:#2ea043; }
    .fineprint { margin:16px 0 0; color:var(--muted); font-size:11px; line-height:1.55; }
    .notice { margin-top:52px; padding-top:20px; border-top:1px solid var(--border); color:var(--muted); font-size:12px; line-height:1.65; }
    @media (max-width:820px) { main { padding-top:40px; } .layout { grid-template-columns:1fr; gap:40px; } .card { width:min(100%,420px); } }
    @media (max-width:480px) { .topbar__inner,main { width:min(100% - 24px,1040px); } .topbar__inner { min-height:52px; } .repo { display:none; } main { padding:32px 0 48px; } h1 { font-size:34px; } .lead { font-size:15px; } .card { padding:16px; } }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="topbar__inner">
      <a class="brand" href="/">KISA Notice</a>
      <a class="repo" href="https://github.com/doraemyon/KISA-Public-Bohonara-Support">GitHub에서 소스 보기</a>
    </div>
  </header>
  <main>
    <div class="layout">
      <section>
        <p class="eyebrow">Telegram notification</p>
        <h1>KISA 보안공지를<br>놓치지 마세요.</h1>
        <p class="lead">보호나라에 새 보안공지가 등록되면 Telegram 개인 메시지로 전달합니다. 가입 신청 후 관리자 승인이 완료되면 별도 설정 없이 알림이 시작됩니다.</p>
        <h2 class="steps-title">가입 방법</h2>
        <ol class="steps" role="list">
          <li class="step">
            <span class="step__number" aria-hidden="true">1</span>
            <div>
              <strong class="step__title">Telegram 봇 열기</strong>
              <p class="step__detail">QR을 스캔하거나 <strong>Telegram 봇 열기</strong>를 누릅니다.</p>
            </div>
          </li>
          <li class="step">
            <span class="step__number" aria-hidden="true">2</span>
            <div>
              <strong class="step__title">신청 명령 보내기</strong>
              <p class="step__detail">Telegram에서 <strong>시작</strong>을 누른 뒤, 봇의 개인 채팅에 아래 형식으로 보냅니다.</p>
              <code class="step__command">/${APPLICATION_COMMAND} 계정명</code>
              <p class="step__detail">명령은 <strong>붙여 쓰고</strong>, 공백 한 칸 뒤에 <strong>본인의 사내 솔루션 계정명</strong>을 입력하세요. 계정 형식은 영문 2자_숫자 5자리입니다. 비밀번호나 인증코드는 보내지 마세요.</p>
            </div>
          </li>
          <li class="step">
            <span class="step__number" aria-hidden="true">3</span>
            <div>
              <strong class="step__title">관리자 승인 기다리기</strong>
              <p class="step__detail"><strong>승인 완료 메시지</strong>가 도착하면 이후 등록되는 보안공지를 받아볼 수 있습니다.</p>
            </div>
          </li>
        </ol>
      </section>
      <aside class="card" aria-label="Telegram 가입 신청">
        <div class="qr">${qr}</div>
        <h2>Telegram에서 신청</h2>
        <p class="handle">@${safeBotUsername}</p>
        <a class="button" href="${safeBotLink}">Telegram 봇 열기</a>
        <p class="fineprint">계정명과 Telegram 프로필 정보는 관리자 승인에 사용되며, 승인 또는 거절 시 신청 데이터베이스에서 삭제됩니다.</p>
      </aside>
    </div>
    <p class="notice">본 서비스는 공개된 KISA 보호나라 보안공지를 전달합니다. 승인은 구독 권한을 부여하는 절차이며, KISA의 공식 서비스나 보안 권고를 대체하지 않습니다.</p>
  </main>
</body>
</html>`;
}

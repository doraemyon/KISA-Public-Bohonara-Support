import { APPLICATION_COMMAND } from "./access";
import { NOTICE_ICON_PATH, required } from "./config";
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
  <meta name="description" content="KISA 보호나라 보안공지를 Telegram으로 전하는 독립적인 비공식 알리미">
  <title>비공식 보호나라 보안공지 알림 신청</title>
  <link rel="icon" type="image/png" href="${NOTICE_ICON_PATH}">
  <style>
    :root { color-scheme: dark; font-family: -apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif; --bg:#0d1117; --panel:#161b22; --panel-2:#21262d; --border:#30363d; --text:#f0f6fc; --muted:#8b949e; --blue:#2f81f7; --green:#238636; }
    * { box-sizing: border-box; }
    body { min-width:320px; min-height:100vh; margin:0; background:var(--bg); color:var(--text); }
    a { color:inherit; }
    .topbar { border-bottom:1px solid var(--border); background:#010409; }
    .topbar__inner, main { width:min(100% - 40px,840px); margin:0 auto; }
    .topbar__inner { display:flex; min-height:60px; align-items:center; justify-content:space-between; gap:16px; }
    .brand { display:inline-flex; align-items:center; gap:8px; font-size:14px; font-weight:600; letter-spacing:-.01em; text-decoration:none; }
    .archive-link { color:var(--muted); font-size:12px; text-decoration:none; }
    .archive-link:hover { color:var(--blue); text-decoration:underline; text-underline-offset:3px; }
    main { padding:54px 0 56px; word-break:keep-all; }
    .intro { text-align:center; }
    .layout { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); align-items:center; gap:48px; margin-top:36px; }
    .signup-steps, .card { width:min(100%,360px); justify-self:center; }
    .eyebrow { margin:0 0 12px; color:#58a6ff; font-size:13px; font-weight:600; }
    h1 { margin:0; font-size:clamp(32px,5.2vw,52px); line-height:1.12; letter-spacing:-.045em; text-wrap:balance; }
    .lead { max-width:600px; margin:16px auto 0; color:var(--muted); font-size:16px; line-height:1.7; text-wrap:pretty; }
    .steps-title { margin:0 0 12px; font-size:16px; }
    .steps { display:grid; margin:0; padding:0; gap:16px; list-style:none; }
    .step { display:grid; grid-template-columns:28px minmax(0,1fr); align-items:start; gap:12px; }
    .step__number { display:grid; width:28px; height:28px; place-items:center; border:1px solid var(--border); border-radius:50%; background:var(--panel); color:var(--text); font-size:12px; font-weight:600; line-height:1; font-variant-numeric:tabular-nums; }
    .step__title { display:block; margin:0 0 2px; font-size:14px; line-height:28px; }
    .step__detail { margin:0; color:var(--muted); font-size:13px; line-height:1.65; }
    .step__detail strong { color:var(--text); }
    .step__command { display:inline-block; max-width:100%; margin:9px 0 7px; padding:7px 11px; border:1px solid var(--border); border-radius:6px; background:var(--panel); color:#e6edf3; font:600 14px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace; overflow-wrap:anywhere; }
    .card { padding:24px; border:1px solid var(--border); border-radius:8px; background:var(--panel); box-shadow:0 16px 48px rgba(1,4,9,.35); text-align:center; }
    .qr { width:100%; aspect-ratio:1; overflow:hidden; border-radius:12px; background:#fff; }
    .qr svg { display:block; width:100%; height:100%; }
    .card h2 { margin:20px 0 6px; font-size:18px; letter-spacing:-.02em; }
    .handle { margin:0 0 18px; color:var(--muted); font:13px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace; }
    .button { display:flex; min-height:44px; padding:9px 16px; align-items:center; justify-content:center; border:1px solid rgba(240,246,252,.1); border-radius:6px; background:var(--green); color:#fff; font-size:14px; font-weight:600; text-decoration:none; }
    .button:hover { background:#2ea043; }
    .fineprint { margin:16px 0 0; color:var(--muted); font-size:11px; line-height:1.55; }
    .notice { max-width:700px; margin:40px auto 0; padding-top:20px; border-top:1px solid var(--border); color:var(--muted); font-size:12px; line-height:1.65; text-align:center; }
    .notice p { margin:0; }
    .notice p + p { margin-top:8px; }
    .notice a { color:#58a6ff; text-underline-offset:2px; }
    @media (max-width:720px) { main { padding-top:40px; } .layout { grid-template-columns:1fr; gap:28px; margin-top:28px; } }
    @media (max-width:480px) { .topbar__inner,main { width:calc(100% - 24px); } .topbar__inner { min-height:52px; } main { padding:32px 0 40px; } .lead { font-size:15px; } .card { padding:16px; } }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="topbar__inner">
      <a class="brand" href="/"><img src="${NOTICE_ICON_PATH}" width="20" height="20" alt="">보안공지 알리미</a>
      <a class="archive-link" href="/notices/">공지 목록</a>
    </div>
  </header>
  <main>
    <header class="intro">
      <p class="eyebrow">비공식 Telegram 알리미</p>
      <h1>보호나라 보안공지 알림</h1>
      <p class="lead">보호나라에 새 보안공지가 등록되면 Telegram 개인 메시지로 전달합니다. 가입 신청 후 관리자 승인이 완료되면 별도 설정 없이 알림이 시작됩니다.</p>
    </header>
    <div class="layout">
      <section class="signup-steps" aria-labelledby="signup-steps-title">
        <h2 class="steps-title" id="signup-steps-title">가입 방법</h2>
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
              <code class="step__command">/${APPLICATION_COMMAND} 성명</code>
              <p class="step__detail">예) <strong>/${APPLICATION_COMMAND} 이예원</strong></p>
              <p class="step__detail">명령은 <strong>붙여 쓰고</strong>, 공백 한 칸 뒤에 <strong>본인의 성명</strong>을 입력하세요.</p>
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
        <p class="fineprint">성명과 Telegram 프로필 정보는 관리자 승인에 사용되며, 승인 또는 거절 시 신청 데이터베이스에서 삭제됩니다.</p>
      </aside>
    </div>
    <footer class="notice" aria-label="서비스 및 라이선스 안내">
      <p>본 서비스는 수익 목적 없이 운영하는 비상업적 프로젝트입니다. 한국인터넷진흥원(KISA)이 제공하는 <a href="https://www.boho.or.kr/kr/rss.do?bbsId=B0000133">보호나라 보안공지 RSS</a>를 활용해 새 공지를 Telegram으로 전달합니다. KISA와 별개로 운영되는 독립적인 비공식 알리미입니다.</p>
      <p>© 2026 · MIT License</p>
    </footer>
  </main>
</body>
</html>`;
}

import { APPLICATION_COMMAND } from "./access";
import { NOTICE_ICON_PATH, publicSiteUrl, required } from "./config";
import { DISCORD_AUTH_PATH, discordSignupConfig } from "./discord-connection";
import { renderSiteHeader, SITE_SHELL_STYLESHEET } from "./site-header";
import { renderSignupQr } from "./signup-qr";
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
  const qr = renderSignupQr(botLink, "telegram");
  const safeBotLink = escapeHtml(botLink);
  const safeBotUsername = escapeHtml(botUsername);
  const canonical = publicSiteUrl(env);
  const discordCard = renderDiscordCard(canonical && discordSignupConfig(env)
    ? new URL(DISCORD_AUTH_PATH, canonical).href : undefined);

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="index,follow">
  <meta name="description" content="KISA 보호나라 보안공지의 Telegram 및 Discord 알림을 신청하세요. 새 공지와 국문·영문 문서를 안내하는 비공식 서비스입니다.">
  <title>비공식 KISA 보호나라 보안공지 | 알림 신청</title>
  ${canonical ? `<link rel="canonical" href="${escapeHtml(canonical.href)}">` : ""}
  <link rel="icon" type="image/png" href="${NOTICE_ICON_PATH}">
  ${SITE_SHELL_STYLESHEET}
  <style>
    :root { --panel:#161b22; --border:#30363d; --text:#f0f6fc; --muted:#8b949e; --green:#238636; }
    a { color:inherit; }
    main { word-break:keep-all; }
    .intro { text-align:center; }
    .signup-switch { position:relative; }
    .signup-choice { position:absolute; width:1px; height:1px; margin:0; opacity:0; clip-path:inset(50%); }
    .signup-nav { display:grid; grid-template-columns:1fr 1fr; gap:4px; max-width:320px; margin:24px auto 0; padding:4px; border:1px solid var(--border); border-radius:10px; background:#010409; }
    .signup-nav label { display:grid; min-height:44px; padding:6px 14px; place-items:center; border:1px solid transparent; border-radius:7px; color:#a5afbf; font-size:14px; font-weight:600; cursor:pointer; }
    .signup-nav label:hover { background:#161b22; color:var(--text); }
    #choose-telegram:checked ~ .signup-nav label[for="choose-telegram"],
    #choose-discord:checked ~ .signup-nav label[for="choose-discord"] { background:#212832; border-color:#3e4c60; color:var(--text); }
    #choose-telegram:focus-visible ~ .signup-nav label[for="choose-telegram"],
    #choose-discord:focus-visible ~ .signup-nav label[for="choose-discord"] { outline:2px solid #58a6ff; outline-offset:2px; }
    #choose-telegram:checked ~ .signup-panels #discord,
    #choose-discord:checked ~ .signup-panels #telegram { display:none; }
    @media (prefers-reduced-motion: no-preference) {
      .signup-nav label { transition:background-color 150ms ease, border-color 150ms ease, color 150ms ease; }
      #choose-telegram:checked ~ .signup-panels #telegram,
      #choose-discord:checked ~ .signup-panels #discord { animation:signup-panel-enter 180ms ease-out; }
    }
    @keyframes signup-panel-enter {
      from { opacity:0; transform:translateY(5px); }
      to { opacity:1; transform:translateY(0); }
    }
    .button.discord { background:#454fbf; }
    .button.discord:hover { background:#515ed5; }
    .discord-status { margin:36px auto 0; max-width:720px; padding-top:20px; text-align:center; }
    .discord-card { border-color:#424676; }
    .step__detail + .step__detail { margin-top:7px; }
    .privacy-note { margin:18px 0 0; padding:11px 13px; border:1px solid #343759; border-radius:8px; background:#181b32; color:#c6cceb; font-size:12px; line-height:1.6; }
    .privacy-note strong { color:var(--text); }
    .discord-status p { color:var(--muted); font-size:14px; }
    .layout { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); align-items:start; gap:48px; margin-top:36px; }
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
    .step__detail a { color:#8cc5ff; font-weight:600; text-underline-offset:2px; }
    .step__command { display:inline-block; max-width:100%; margin:9px 0 7px; padding:7px 11px; border:1px solid var(--border); border-radius:6px; background:var(--panel); color:#e6edf3; font-family:inherit; font-size:14px; font-weight:600; line-height:1.5; overflow-wrap:anywhere; }
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
    @media (max-width:720px) { .layout { grid-template-columns:1fr; gap:28px; margin-top:28px; } }
    @media (max-width:480px) { .lead { font-size:15px; } .card { padding:16px; } }
  </style>
</head>
<body>
  ${renderSiteHeader("보안공지 알리미", "/", { showArchiveLink: true })}
  <main class="public-content">
    <header class="intro">
      <p class="eyebrow">비공식 KISA 보호나라 보안공지</p>
      <h1>보호나라 보안공지를 놓치지 마세요.</h1>
      <p class="lead">KISA 보호나라에 새 보안공지가 등록되면 알림을 보내드립니다.<br>Telegram 또는 Discord에서 구독을 신청하고 관리자 승인을 받으세요.</p>
    </header>
    <div class="signup-switch" role="group" aria-label="알림 플랫폼 선택">
      <input class="signup-choice" id="choose-telegram" type="radio" name="signup-platform" aria-controls="telegram" checked>
      <input class="signup-choice" id="choose-discord" type="radio" name="signup-platform" aria-controls="discord">
      <div class="signup-nav">
        <label for="choose-telegram">Telegram</label>
        <label for="choose-discord">Discord</label>
      </div>
      <div class="signup-panels">
        <div class="layout" id="telegram">
          <section class="signup-steps" aria-labelledby="signup-steps-title">
            <h2 class="steps-title" id="signup-steps-title">Telegram 가입 방법</h2>
            <ol class="steps" role="list">
              <li class="step">
                <span class="step__number" aria-hidden="true">1</span>
                <div>
                  <strong class="step__title">Telegram 봇 열기</strong>
                  <p class="step__detail">QR을 스캔하거나 <a href="${safeBotLink}">Telegram 봇 열기</a>를 누르세요.</p>
                </div>
              </li>
              <li class="step">
                <span class="step__number" aria-hidden="true">2</span>
                <div>
                  <strong class="step__title">알람 구독 신청하기</strong>
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
        ${discordCard}
      </div>
    </div>
    <footer class="notice" aria-label="서비스 및 라이선스 안내">
      <p>본 서비스는 수익 목적 없이 운영하는 비상업적 프로젝트이며, KISA와 별개로 운영되는 독립적인 비공식 알리미 서비스입니다.<br>한국인터넷진흥원(KISA)이 제공하는 <a href="https://www.boho.or.kr/kr/rss.do?bbsId=B0000133">보호나라 보안공지 RSS</a>를 활용해 새 공지 알림을 전달합니다.</p>
      <p>© 2026 · MIT License</p>
    </footer>
  </main>
</body>
</html>`;
}

function renderDiscordCard(signupUrl: string | undefined): string {
  if (!signupUrl) {
    return `<section class="discord-status" id="discord" aria-labelledby="discord-title">
      <h2 class="steps-title" id="discord-title">Discord 가입</h2>
      <p>Discord 구독 신청은 연결 준비 중입니다.</p>
    </section>`;
  }
  return `<section class="layout" id="discord" aria-labelledby="discord-title">
      <div class="signup-steps">
        <h2 class="steps-title" id="discord-title">Discord 가입 방법</h2>
        <ol class="steps" role="list">
          <li class="step">
            <span class="step__number" aria-hidden="true">1</span>
            <div><strong class="step__title">Discord 연결 화면 열기</strong>
              <p class="step__detail">QR을 스캔하거나 <a href="${escapeHtml(signupUrl)}">Discord에서 신청</a>을 누른 뒤 <strong>본인의 성명</strong>을 입력하세요.</p></div>
          </li>
          <li class="step">
            <span class="step__number" aria-hidden="true">2</span>
            <div>
              <strong class="step__title">내 서버와 채널 선택</strong>
              <p class="step__detail"><strong>서버에 추가</strong>에는 로그인한 <strong>내 Discord 계정이 관리할 수 있는 서버</strong>가 표시됩니다.</p>
              <p class="step__detail">예를 들어 본인 서버가 <strong>‘&lt;본인 닉네임&gt;님의 서버’</strong>로 표시되면 그 항목을 고르세요. 서버 이름을 바꿨다면 현재 이름으로 찾으세요.</p>
              <p class="step__detail">내 서버를 고른 뒤 <strong>웹후크 추가하기</strong>에서 알림을 받을 <strong>비공개 텍스트 채널</strong>을 선택하고 <strong>허용</strong>을 누르세요.</p>
              <p class="step__detail">서버가 없다면 Discord의 <strong>서버 추가(＋) → 직접 만들기</strong>에서 내 서버를 만들고, 그 안에 비공개 텍스트 채널을 추가하세요.</p>
            </div>
          </li>
          <li class="step">
            <span class="step__number" aria-hidden="true">3</span>
            <div><strong class="step__title">관리자 승인 기다리기</strong>
              <p class="step__detail">승인되면 선택한 채널로 새 공지가 전송됩니다. 푸시가 필요하면 채널 알림을 <strong>모든 메시지</strong>로 설정하세요.</p></div>
          </li>
        </ol>
        <p class="privacy-note"><strong>같은 QR을 공유해도 각자 따로 받습니다.</strong> 구독자는 각자 자기 서버와 채널을 선택합니다. 운영자와 다른 구독자의 계정이나 서버는 이 과정에서 서로 공개되지 않습니다.</p>
      </div>
      <aside class="card discord-card" aria-label="Discord 가입 신청">
        <div class="qr">${renderSignupQr(signupUrl, "discord")}</div>
        <h2>Discord에서 신청</h2>
        <a class="button discord" href="${escapeHtml(signupUrl)}">Discord에서 신청</a>
        <p class="fineprint">신청 성명은 관리자 승인에 사용되며 신청 처리 후 삭제됩니다.</p>
      </aside>
    </section>`;
}

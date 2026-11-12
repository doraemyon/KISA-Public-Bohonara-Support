import { renderSVG } from "uqr";

import { APPLICATION_COMMAND } from "./access";
import { required } from "./config";
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
  const qr = renderSVG(botLink, {
    ecc: "M",
    border: 3,
    pixelSize: 6,
    blackColor: "#0d1117",
    whiteColor: "#ffffff",
  });
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
    .steps { display:grid; margin:36px 0 0; padding:0; gap:18px; list-style:none; }
    .step { display:grid; grid-template-columns:32px minmax(0,1fr); gap:12px; }
    .step__number { display:flex; width:28px; height:28px; align-items:center; justify-content:center; border:1px solid var(--border); border-radius:50%; background:var(--panel); color:var(--muted); font-size:12px; font-weight:600; }
    .step strong { display:block; margin:2px 0 4px; font-size:14px; }
    .step span { display:block; color:var(--muted); font-size:13px; line-height:1.55; }
    .card { padding:24px; border:1px solid var(--border); border-radius:8px; background:var(--panel); box-shadow:0 16px 48px rgba(1,4,9,.35); }
    .qr { display:flex; width:100%; aspect-ratio:1; padding:16px; align-items:center; justify-content:center; border-radius:6px; background:#fff; }
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
        <ol class="steps">
          <li class="step"><span class="step__number">1</span><div><strong>Telegram 봇 열기</strong><span>휴대폰으로 QR을 촬영하거나 오른쪽 버튼을 누릅니다.</span></div></li>
          <li class="step"><span class="step__number">2</span><div><strong>사내 솔루션 계정명 입력</strong><span>가입 자격 확인을 위해 Telegram에서 시작 버튼을 누른 뒤 <code>/${APPLICATION_COMMAND} 계정명</code>을 보내 주세요. 계정 형식은 영문 2자_숫자 5자리입니다. 비밀번호나 인증코드는 보내지 마세요.</span></div></li>
          <li class="step"><span class="step__number">3</span><div><strong>관리자 승인 기다리기</strong><span>승인 완료 메시지가 도착한 뒤부터 새 공지를 받아볼 수 있습니다.</span></div></li>
        </ol>
      </section>
      <aside class="card" aria-label="Telegram 가입 신청">
        <div class="qr" aria-label="Telegram 봇 가입 QR 코드">${qr}</div>
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

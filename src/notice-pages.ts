import { httpsUrl, NOTICE_ICON_PATH, publicSiteUrl } from "./config";
import { noticeIdFromLink } from "./rss";
import { renderSiteHeader, SITE_SHELL_STYLESHEET } from "./site-header";
import type { Env, InlineKeyboard } from "./types";

type Language = "ko" | "en";

const DOCUMENT_PATH = /^\/notices\/(\d{1,20})\/(ko|en)\/(notice\.txt)?$/;
const PUBLICATION_PATH = /^\/notices\/(\d{1,20})\/status\.json$/;
const STYLE_PATH = "/assets/style.css";
const COPY_PATH = "/assets/app.js";
const STATUS_PATH = "/assets/notice-status.js";
const KISA_ORIGIN = "https://www.boho.or.kr";
const ARCHIVE_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const NOTICE_STATUS_SCRIPT = `"use strict";
const retry = document.getElementById("retry-button");
const status = document.getElementById("check-status");
const english = document.documentElement.lang === "en";
let timer;
let delay = 5000;
async function check() {
  if (retry.disabled) return;
  clearTimeout(timer);
  retry.disabled = true;
  status.textContent = english ? "Checking publication status…" : "게시 상태를 확인하고 있습니다…";
  try {
    const response = await fetch(new URL("../status.json", window.location.href), { cache: "no-store" });
    if (response.ok) {
      const url = new URL(window.location.href);
      url.searchParams.delete("check");
      url.searchParams.set("published", String(Date.now()));
      window.location.replace(url);
      return;
    }
    if (response.status === 503) throw new Error("Archive temporarily unavailable.");
    status.textContent = english ? "This page checks again automatically." : "아직 준비 중입니다. 잠시 후 자동으로 확인합니다.";
  } catch {
    status.textContent = english ? "Could not check the page. Retrying shortly." : "확인하지 못했습니다. 잠시 후 다시 시도합니다.";
  } finally {
    retry.disabled = false;
    timer = setTimeout(check, delay);
    delay = Math.min(delay * 2, 60000);
  }
}
retry.addEventListener("click", check);
timer = setTimeout(check, 1200);
`;

export function noticeKeyboard(env: Env, sourceLink: string): InlineKeyboard {
  const keyboard: InlineKeyboard = [[{ text: "공지 열기", url: sourceLink }]];
  const base = publicSiteUrl(env);
  if (!base) return keyboard;
  try {
    const id = noticeIdFromLink(sourceLink);
    keyboard.push([
      { text: "국문 공지", url: `${base.origin}/notices/${id}/ko/` },
      { text: "영문 공지", url: `${base.origin}/notices/${id}/en/` },
    ]);
  } catch {
    // The original notice link remains available when its ID is missing.
  }
  return keyboard;
}

function archiveHeaders(contentType: string, cache = "no-store"): Headers {
  return new Headers({
    "Content-Type": `${contentType}; charset=utf-8`,
    "Cache-Control": cache,
    "Content-Security-Policy": ARCHIVE_CSP,
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-Robots-Tag": "noindex, noarchive",
  });
}

export function archiveLink(value: string, source: URL, base: URL): string | null {
  if (value.startsWith("#")) return value;
  try {
    const target = new URL(value, source);
    if (target.origin === base.origin && target.pathname.startsWith(base.pathname)) {
      const path = "/" + target.pathname.slice(base.pathname.length);
      if (path === "/" || path === "/index.html") return "/notices/";
      if (DOCUMENT_PATH.test(path) || path === STYLE_PATH || path === COPY_PATH) return path;
    }
    if (target.origin === KISA_ORIGIN && target.pathname.startsWith("/kr/")) return target.href;
  } catch {
    // Malformed URLs are omitted from the mirrored page.
  }
  return null;
}

function archiveLabel(language: Language = "ko"): string {
  return language === "en" ? "Unofficial Notice Viewer" : "비공식 보호나라 보안공지";
}

function mirrorHtml(response: Response, source: URL, base: URL, language?: Language): Response {
  const rewrite = new HTMLRewriter()
    .on("base", { element(element) { element.remove(); } })
    .on("meta[http-equiv]", { element(element) { element.remove(); } })
    .on("head", { element(element) { element.append(SITE_SHELL_STYLESHEET, { html: true }); } })
    .on("header.site-header", {
      element(element) {
        element.replace(
          renderSiteHeader(archiveLabel(language), "/notice", { alignWithArchive: !language }),
          { html: true },
        );
      },
    })
    .on("main.page-shell", {
      element(element) {
        if (!language) return;
        const classes = element.getAttribute("class");
        element.setAttribute("class", `${classes} public-content`);
      },
    })
    .on("a[href]", {
      element(element) {
        const original = element.getAttribute("href") ?? "";
        const href = archiveLink(original, source, base);
        if (!href) element.removeAttribute("href");
        else if (href !== original) element.setAttribute("href", href);
        element.removeAttribute("ping");
      },
    })
    .on("link", {
      element(element) {
        if (element.getAttribute("rel") === "icon") {
          element.setAttribute("href", NOTICE_ICON_PATH);
        } else if (
          element.getAttribute("rel") === "stylesheet" &&
          archiveLink(element.getAttribute("href") ?? "", source, base) === STYLE_PATH
        ) {
          element.setAttribute("href", STYLE_PATH);
        } else {
          element.remove();
        }
      },
    })
    .on("img", {
      element(element) {
        element.removeAttribute("srcset");
        element.remove();
      },
    })
    .on("script", {
      element(element) {
        if (archiveLink(element.getAttribute("src") ?? "", source, base) === COPY_PATH) {
          element.setAttribute("src", COPY_PATH);
        } else {
          element.remove();
        }
      },
    });
  return rewrite.transform(response);
}

function pendingNotice(id: string, language: Language, status: number): Response {
  const english = language === "en";
  const title = english ? "Preparing the notice" : "공지 문서를 준비하고 있습니다";
  const description = english
    ? "This page opens automatically once both the Korean and English documents are published."
    : "국문·영문 문서 게시가 완료되면 이 페이지에서 자동으로 공지를 엽니다.";
  const original = `${KISA_ORIGIN}/kr/bbs/view.do?bbsId=B0000133&amp;menuNo=205020&amp;nttId=${id}`;
  return new Response(`<!doctype html>
<html lang="${language}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · ${archiveLabel(language)}</title>
<link rel="icon" href="${NOTICE_ICON_PATH}"><link rel="stylesheet" href="${STYLE_PATH}">${SITE_SHELL_STYLESHEET}
<script src="${STATUS_PATH}" defer></script></head><body>
${renderSiteHeader(archiveLabel(language), "/notice")}
<main class="page-shell public-content"><section class="pending-card">
<div class="pending-card__mark" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 1.5a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11Zm-.75 2.25h1.5v3l2 1.5-.9 1.2-2.6-1.95Z"/></svg></div>
<p class="pending-card__eyebrow">Security notice</p><h1>${title}</h1>
<p class="pending-card__description">${description}</p>
<div class="pending-card__actions">
<button class="button button--primary" id="retry-button" type="button">${english ? "Check again" : "다시 확인"}</button>
<a class="button" href="${original}">${english ? "KISA source" : "KISA 원문"}</a>
</div><p class="pending-card__status" id="check-status" aria-live="polite"></p>
</section></main></body></html>`, { status, headers: archiveHeaders("text/html") });
}

async function archiveFetch(base: URL, path: string, version: string, method = "GET"): Promise<Response> {
  const target = new URL(path.slice(1), base);
  if (version) target.searchParams.set("v", version);
  return fetch(target, { method, redirect: "manual", signal: AbortSignal.timeout(8000) });
}

async function publicationStatus(
  base: URL, id: string, version: string, requestedPath?: string,
): Promise<200 | 404 | 503> {
  const files = ["ko/", "ko/notice.txt", "en/", "en/notice.txt"]
    .map(file => ({ path: `/notices/${id}/${file}`, type: file.endsWith(".txt") ? "text/plain" : "text/html" }))
    .filter(file => file.path !== requestedPath);
  const [metadata, ...documents] = await Promise.all([
    archiveFetch(base, `/notices/${id}/metadata.json`, version),
    ...files.map(file => archiveFetch(base, file.path, version, "HEAD")),
  ]);
  const responses = [metadata, ...documents];
  if (responses.some(response => !response.ok && response.status !== 404)) {
    await metadata.body?.cancel();
    return 503;
  }
  if (responses.some(response => response.status === 404)) {
    await metadata.body?.cancel();
    return 404;
  }
  if (documents.some((response, index) =>
    response.headers.get("Content-Type")?.split(";")[0].toLowerCase() !== files[index].type,
  )) {
    await metadata.body?.cancel();
    return 503;
  }
  const record = await metadata.json<{ notice_id?: string; translation_status?: string }>();
  // Older published pairs predate the explicit translation_status field.
  if (record.notice_id !== id) return 503;
  return (record.translation_status ?? "complete") === "complete" ? 200 : 404;
}

function publicationResponse(status: 200 | 404 | 503): Response {
  const state = status === 200 ? "ready" : status === 404 ? "pending" : "unavailable";
  return new Response(JSON.stringify({ state }), {
    status, headers: archiveHeaders("application/json"),
  });
}

export async function serveNoticePage(url: URL, env: Env): Promise<Response | null> {
  const path = url.pathname;
  if (path === "/notice" || path === "/notice/") {
    return new Response(null, { status: 308, headers: { Location: "/notices/" + url.search } });
  }
  if (path === "/notices" || /^\/notices\/\d{1,20}\/(ko|en)$/.test(path)) {
    return new Response(null, { status: 308, headers: { Location: path + "/" } });
  }
  if (path === "/assets/notice-icon.svg") {
    return new Response(null, { status: 308, headers: { Location: NOTICE_ICON_PATH } });
  }
  if (path === STATUS_PATH) {
    return new Response(NOTICE_STATUS_SCRIPT, { headers: archiveHeaders("text/javascript", "public, max-age=300") });
  }
  const document = DOCUMENT_PATH.exec(path);
  const statusId = PUBLICATION_PATH.exec(path)?.[1];
  const index = path === "/notices/";
  const asset = path === STYLE_PATH || path === COPY_PATH;
  if (!document && !statusId && !index && !asset) return null;

  const id = document?.[1];
  const language = document?.[2] as Language | undefined;
  const text = Boolean(document?.[3]);
  const base = httpsUrl(env.NOTICE_ARCHIVE_ORIGIN);
  const unavailable = (status: number) => id && language && !text
    ? pendingNotice(id, language, status)
    : new Response(status === 404 ? "문서를 찾을 수 없습니다." : "공지 문서를 확인하는 중입니다. 잠시 후 다시 시도해 주세요.", {
        status, headers: archiveHeaders("text/plain"),
      });
  if (!base || base.origin === url.origin) {
    return statusId ? publicationResponse(503) : unavailable(503);
  }
  base.pathname = base.pathname.replace(/\/*$/, "/");

  const upstreamPath = index ? "/" : path;
  const checking = Boolean(statusId) || url.searchParams.has("check") || url.searchParams.has("published");
  const version = checking ? String(Math.floor(Date.now() / 5000)) : "";
  try {
    if (statusId) return publicationResponse(await publicationStatus(base, statusId, version));
    const response = await archiveFetch(base, upstreamPath, version);
    if (!response.ok) {
      await response.body?.cancel();
      return unavailable(response.status === 404 ? 404 : 503);
    }
    if (id) {
      const status = await publicationStatus(base, id, version, path);
      if (status !== 200) {
        await response.body?.cancel();
        return unavailable(status);
      }
    }
    const type = text ? "text/plain" : path === STYLE_PATH ? "text/css" : path === COPY_PATH ? "text/javascript" : "text/html";
    const upstreamType = response.headers.get("Content-Type")?.split(";")[0].toLowerCase();
    if (upstreamType !== type && !(type === "text/javascript" && upstreamType === "application/javascript")) {
      await response.body?.cancel();
      return unavailable(503);
    }
    const result = new Response(response.body, {
      headers: archiveHeaders(type, checking ? "no-store" : "public, max-age=30"),
    });
    return type === "text/html"
      ? mirrorHtml(result, new URL(upstreamPath.slice(1), base), base, language)
      : result;
  } catch {
    return statusId ? publicationResponse(503) : unavailable(503);
  }
}

import { NOTICE_ICON_PATH } from "./config";

export const SITE_SHELL_STYLESHEET = '<link rel="stylesheet" href="/assets/site-shell.css">';

export function renderSiteHeader(
  label: string,
  brandHref: string,
  { link, alignWithArchive = false }: { link?: "archive" | "subscribe"; alignWithArchive?: boolean } = {},
): string {
  const navigation = link === "archive"
    ? '<a class="topbar-link" href="/notices/">공지 목록</a>'
    : link === "subscribe" ? '<a class="topbar-link" href="/">구독하기</a>' : "";
  return `<header class="topbar">
    <div class="topbar__inner${alignWithArchive ? " site-header__inner" : ""}">
      <a class="brand" href="${brandHref}"><img src="${NOTICE_ICON_PATH}" width="20" height="20" alt="">${label}</a>
      ${navigation}
    </div>
  </header>`;
}

import { NOTICE_ICON_PATH } from "./config";

export const SITE_SHELL_STYLESHEET = '<link rel="stylesheet" href="/assets/site-shell.css">';

export function renderSiteHeader(label: string, showArchiveLink = false): string {
  return `<header class="topbar">
    <div class="topbar__inner">
      <a class="brand" href="/"><img src="${NOTICE_ICON_PATH}" width="20" height="20" alt="">${label}</a>
      ${showArchiveLink ? '<a class="archive-link" href="/notices/">공지 목록</a>' : ""}
    </div>
  </header>`;
}

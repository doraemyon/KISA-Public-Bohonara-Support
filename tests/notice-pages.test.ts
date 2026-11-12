import { afterEach, describe, expect, it, vi } from "vitest";

import { archiveLink, noticeKeyboard, serveNoticePage } from "../src/notice-pages";
import type { Env } from "../src/types";

const archive = new URL("https://example.github.io/formatter/");
const publicSite = "https://alerts.example.test";
const original = "https://www.boho.or.kr/kr/bbs/view.do?bbsId=B0000133&nttId=72298";
const env = {
  NOTICE_ARCHIVE_ORIGIN: archive.href,
  PUBLIC_BASE_URL: publicSite,
} as Env;

afterEach(() => vi.unstubAllGlobals());

describe("public notice archive", () => {
  it("builds buttons for the Worker without using the source archive as a fallback", () => {
    expect(noticeKeyboard(env, original)).toEqual([
      [{ text: "공지 열기", url: original }],
      [
        { text: "국문 공지", url: `${publicSite}/notices/72298/ko/` },
        { text: "영문 공지", url: `${publicSite}/notices/72298/en/` },
      ],
    ]);
    expect(noticeKeyboard({ ...env, PUBLIC_BASE_URL: archive.origin }, original)).toHaveLength(1);
  });

  it("maps archives, language switches, downloads, and assets onto the same host", () => {
    const page = new URL("notices/72298/en/", archive);
    expect(archiveLink("../../../", page, archive)).toBe("/notices/");
    expect(archiveLink("../ko/", page, archive)).toBe("/notices/72298/ko/");
    expect(archiveLink("./notice.txt", page, archive)).toBe("/notices/72298/en/notice.txt");
    expect(archiveLink("../../../assets/app.js", page, archive)).toBe("/assets/app.js");
    expect(archiveLink(original, page, archive)).toBe(original);
    expect(archiveLink("https://github.com/example/formatter", page, archive)).toBeNull();
    expect(archiveLink("./metadata.json", page, archive)).toBeNull();
  });

  it("does not publish a single language when its counterpart is missing", async () => {
    vi.stubGlobal("fetch", vi.fn((url: URL) => {
      if (url.pathname.endsWith("/metadata.json")) {
        return Response.json({ notice_id: "72298", translation_status: "complete" });
      }
      if (url.pathname.endsWith("/ko/")) return new Response("<h1>국문</h1>");
      return new Response("missing", { status: 404 });
    }));
    const response = await serveNoticePage(new URL("/notices/72298/ko/?check=1", publicSite), env);
    expect(response?.status).toBe(404);
    expect(response?.headers.get("Cache-Control")).toBe("no-store");
    const html = await response?.text();
    expect(html).toContain("국문·영문 문서 게시가 완료되면");
    expect(html).not.toContain("github.io");
  });

  it("does not forward upstream redirects or expose archive internals", async () => {
    const fetchArchive = vi.fn(() =>
      new Response(null, { status: 302, headers: { Location: archive.href } }),
    );
    vi.stubGlobal("fetch", fetchArchive);
    const response = await serveNoticePage(new URL("/notices/72298/en/", publicSite), env);
    expect(response?.status).toBe(503);
    expect(response?.headers.get("Location")).toBeNull();
    expect(await response?.text()).not.toContain("github.io");
    expect(await serveNoticePage(new URL("/notices/72298/metadata.json", publicSite), env)).toBeNull();
    expect(fetchArchive).toHaveBeenCalledTimes(1);
  });

  it("distinguishes a complete publication, a missing download, and an upstream outage", async () => {
    let downloadStatus = 200;
    vi.stubGlobal("fetch", vi.fn((url: URL) => {
      if (url.pathname.endsWith("/metadata.json")) return Response.json({ notice_id: "72298" });
      const download = url.pathname.endsWith(".txt");
      const status = url.pathname.endsWith("/en/notice.txt") ? downloadStatus : 200;
      return new Response(null, {
        status, headers: { "Content-Type": download ? "text/plain" : "text/html" },
      });
    }));
    const url = new URL("/notices/72298/status.json", publicSite);
    for (const [upstream, expectedStatus, state] of [
      [200, 200, "ready"], [404, 404, "pending"], [503, 503, "unavailable"],
    ] as const) {
      downloadStatus = upstream;
      const response = await serveNoticePage(url, env);
      expect(response?.status).toBe(expectedStatus);
      expect(await response?.json()).toEqual({ state });
      expect(response?.headers.get("Cache-Control")).toBe("no-store");
    }
  });
});

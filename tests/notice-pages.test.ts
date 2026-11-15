import { afterEach, describe, expect, it, vi } from "vitest";

import { archiveLink, noticeKeyboard, serveNoticePage } from "../src/notice-pages";
import type { Env } from "../src/types";

const archive = new URL("https://example.github.io/formatter/");
const publicSite = "https://alerts.example.test";
const original = "https://www.boho.or.kr/kr/bbs/view.do?bbsId=B0000133&nttId=72298";
const env = {
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
    const attachment = original + "#:~:text=Guide.pdf";
    expect(archiveLink(attachment, page, archive)).toBe(attachment);
    expect(archiveLink("https://github.com/example/formatter", page, archive)).toBeNull();
    expect(archiveLink("./metadata.json", page, archive)).toBeNull();
  });

  it("serves downloads and readiness from D1 without requesting the old archive", async () => {
    const byId = vi.fn(async (id: string) => id === "72298" ? { body: "UTF-8 영어 문서" } : null);
    const db = {
      prepare() {
        return { bind: (id: string) => ({ first: () => byId(id) }) };
      },
    } as unknown as D1Database;
    const network = vi.fn(() => { throw new Error("unexpected request"); });
    vi.stubGlobal("fetch", network);
    const native = { ...env, DB: db, NOTICE_WORKFLOW_REPOSITORY: "example/formatter" };
    const download = await serveNoticePage(new URL("/notices/72298/en/notice.txt", publicSite), native);
    expect(download?.headers.get("X-Notice-Archive")).toBe("d1");
    expect(await download?.text()).toBe("UTF-8 영어 문서");
    const ready = await serveNoticePage(new URL("/notices/72298/status.json", publicSite), native);
    expect(await ready?.json()).toEqual({ state: "ready" });
    const pending = await serveNoticePage(new URL("/notices/72299/status.json", publicSite), native);
    expect(pending?.status).toBe(404);
    expect(await pending?.json()).toEqual({ state: "pending" });
    expect(network).not.toHaveBeenCalled();
  });

  it("distinguishes a pending notice from a D1 outage without leaking its details", async () => {
    let databaseAvailable = true;
    const db = {
      prepare() {
        return { bind: () => ({ first: async () => {
          if (!databaseAvailable) throw new Error("private database details");
          return null;
        } }) };
      },
    } as unknown as D1Database;
    const url = new URL("/notices/72298/ko/?check=1", publicSite);
    for (const [available, expectedStatus, state] of [
      [true, 404, "pending"], [false, 503, "unavailable"],
    ] as const) {
      databaseAvailable = available;
      const response = await serveNoticePage(url, { ...env, DB: db });
      expect(response?.status).toBe(expectedStatus);
      expect(response?.headers.get("Cache-Control")).toBe("no-store");
      const html = await response?.text();
      expect(html).toContain("국문·영문 문서 게시가 완료되면");
      expect(html).not.toContain("private database details");
      const status = await serveNoticePage(new URL("../status.json", url), { ...env, DB: db });
      expect(await status?.json()).toEqual({ state });
    }
    expect(await serveNoticePage(new URL("../metadata.json", url), env)).toBeNull();
  });
});

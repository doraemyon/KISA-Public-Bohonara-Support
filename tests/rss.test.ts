import { describe, expect, it } from "vitest";

import { noticeIdFromLink, parseKisaRss } from "../src/rss";

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>KISA 보안공지</title>
    <item>
      <title><![CDATA[Apache 제품 보안 업데이트 권고]]></title>
      <link>https://www.boho.or.kr/kr/bbs/view.do?bbsId=B0000133&amp;nttId=72289</link>
      <guid>notice-72289</guid>
      <pubDate>Sat, 07 Nov 2026 09:00:00 +0900</pubDate>
    </item>
  </channel>
</rss>`;

describe("KISA RSS parser", () => {
  it("extracts a numeric notice id and UTF-8 title", () => {
    expect(parseKisaRss(SAMPLE_RSS)).toEqual([
      {
        id: "72289",
        title: "Apache 제품 보안 업데이트 권고",
        link: "https://www.boho.or.kr/kr/bbs/view.do?bbsId=B0000133&nttId=72289",
        published: "Sat, 07 Nov 2026 09:00:00 +0900",
      },
    ]);
  });

  it("rejects links without a KISA notice number", () => {
    expect(() => noticeIdFromLink("https://example.com/not-a-notice")).toThrow(
      "numeric nttId",
    );
  });

  it("fails closed when no valid notice exists", () => {
    expect(() => parseKisaRss("<rss><channel /></rss>")).toThrow(
      "no valid security notices",
    );
  });
});

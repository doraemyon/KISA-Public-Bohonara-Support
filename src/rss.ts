import { XMLParser } from "fast-xml-parser";

import type { Notice } from "./types";

const NOTICE_ID_PATTERN = /(?:[?&])nttId=(\d{1,20})(?:&|$)/;

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value).replace(/\s+/g, " ").trim();
  }
  if (value && typeof value === "object" && "#text" in value) {
    return text((value as { "#text": unknown })["#text"]);
  }
  return "";
}

export function noticeIdFromLink(link: string): string {
  const match = NOTICE_ID_PATTERN.exec(link);
  if (!match) throw new Error("KISA notice URL has no numeric nttId.");
  return match[1];
}

export function parseKisaRss(xml: string): Notice[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    trimValues: true,
  });
  const parsed = parser.parse(xml) as {
    rss?: { channel?: { item?: unknown | unknown[] } };
  };
  const items = asArray(parsed.rss?.channel?.item);
  const notices: Notice[] = [];

  for (const candidate of items) {
    if (!candidate || typeof candidate !== "object") continue;
    const item = candidate as Record<string, unknown>;
    const title = text(item.title);
    const link = text(item.link);
    if (!title || !link) continue;
    try {
      notices.push({
        id: noticeIdFromLink(link),
        title,
        link,
        published: text(item.pubDate),
      });
    } catch {
      // Ignore unrelated or malformed RSS items instead of poisoning state.
    }
  }

  if (notices.length === 0) {
    throw new Error("KISA RSS contained no valid security notices.");
  }
  return notices;
}

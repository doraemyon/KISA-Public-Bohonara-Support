import { publicSiteUrl } from "./config";
import { isNoticePublisher } from "./github-oidc";
import type { Env } from "./types";

const MAX_PUBLICATION_BYTES = 1_800_000;
const DOCUMENT_COLUMNS = {
  ko: { html: "ko_html", text: "ko_text" },
  en: { html: "en_html", text: "en_text" },
} as const;

export type NoticeLanguage = keyof typeof DOCUMENT_COLUMNS;

export async function findNoticeIndex(db: D1Database): Promise<string | null> {
  const row = await db.prepare("SELECT html FROM notice_archive_index WHERE id = 1").first<{ html: string }>();
  return row?.html ?? null;
}

export async function hasNoticeDocument(db: D1Database, noticeId: string): Promise<boolean> {
  return Boolean(await db.prepare(
    "SELECT 1 FROM notice_documents WHERE notice_id = ?1",
  ).bind(noticeId).first());
}

export async function findNoticeDocument(
  db: D1Database, noticeId: string, language: NoticeLanguage, plain: boolean,
): Promise<string | null> {
  const column = DOCUMENT_COLUMNS[language][plain ? "text" : "html"];
  const row = await db.prepare(
    `SELECT ${column} AS body FROM notice_documents WHERE notice_id = ?1`,
  ).bind(noticeId).first<{ body: string }>();
  return row?.body ?? null;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function readPublication(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_PUBLICATION_BYTES) {
      await reader.cancel();
      return null;
    }
    body += decoder.decode(value, { stream: true });
  }
  return JSON.parse(body + decoder.decode());
}

function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export async function handleNoticePublication(request: Request, env: Env): Promise<Response> {
  const repository = env.NOTICE_WORKFLOW_REPOSITORY;
  const site = publicSiteUrl(env);
  if (!repository || !site) return json({ ok: false }, 404);
  const audience = new URL("/internal/notice-publication", site).href;
  if (!await isNoticePublisher(request, repository, audience)) return json({ ok: false }, 401);

  if (request.method === "GET") {
    const [index, documents] = await env.DB.batch<{ notice_id: string; digest: string }>([
      env.DB.prepare("SELECT digest FROM notice_archive_index WHERE id = 1"),
      env.DB.prepare("SELECT notice_id, digest FROM notice_documents"),
    ]);
    return json({
      index: index.results[0]?.digest ?? "",
      documents: Object.fromEntries(documents.results.map((row) => [row.notice_id, row.digest])),
    });
  }
  if (request.method !== "POST") return json({ ok: false }, 405);

  let payload: unknown;
  try {
    payload = await readPublication(request);
  } catch {
    return json({ ok: false }, 400);
  }
  if (!payload || typeof payload !== "object") return json({ ok: false }, 400);
  const record = payload as Record<string, unknown>;
  const { digest } = record;
  if (typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest)) return json({ ok: false }, 400);

  if (record.kind === "index" && nonempty(record.html)) {
    await env.DB.prepare(
      `INSERT INTO notice_archive_index (id, digest, html) VALUES (1, ?1, ?2)
       ON CONFLICT (id) DO UPDATE SET digest = excluded.digest, html = excluded.html
       WHERE notice_archive_index.digest <> excluded.digest`,
    ).bind(digest, record.html).run();
  } else if (record.kind === "document") {
    const { id, koHtml, enHtml, koText, enText } = record;
    if (typeof id !== "string" || !/^\d{1,20}$/.test(id) ||
        !nonempty(koHtml) || !nonempty(enHtml) || !nonempty(koText) || !nonempty(enText)) {
      return json({ ok: false }, 400);
    }
    // Both languages and downloads become visible together in a single statement.
    await env.DB.prepare(
      `INSERT INTO notice_documents (notice_id, digest, ko_html, en_html, ko_text, en_text)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT (notice_id) DO UPDATE SET digest = excluded.digest,
         ko_html = excluded.ko_html, en_html = excluded.en_html,
         ko_text = excluded.ko_text, en_text = excluded.en_text
       WHERE notice_documents.digest <> excluded.digest`,
    ).bind(id, digest, koHtml, enHtml, koText, enText).run();
  } else {
    return json({ ok: false }, 400);
  }
  return json({ ok: true });
}

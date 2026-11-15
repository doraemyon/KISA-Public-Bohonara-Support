import type { Env } from "./types";

export async function dispatchNoticePublication(env: Env): Promise<void> {
  const repository = env.NOTICE_WORKFLOW_REPOSITORY;
  const token = env.NOTICE_WORKFLOW_TOKEN;
  if (!token || !repository || !/^[\w.-]+\/[\w.-]+$/.test(repository)) return;

  const now = new Date();
  const recent = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const retry = new Date(now.getTime() + 20 * 60 * 1000).toISOString();
  const notice = await env.DB.prepare(
    `INSERT INTO notice_dispatch_attempts (notice_id, retry_at)
     SELECT n.notice_id, ?1
     FROM notices n
     LEFT JOIN notice_documents d ON n.notice_id = d.notice_id
     LEFT JOIN notice_dispatch_attempts a ON n.notice_id = a.notice_id
     WHERE d.notice_id IS NULL AND n.discovered_at >= ?2
       AND (a.retry_at IS NULL OR a.retry_at <= ?3)
     ORDER BY n.discovered_at DESC, CAST(n.notice_id AS INTEGER) DESC
     LIMIT 1
     ON CONFLICT(notice_id) DO UPDATE SET retry_at = excluded.retry_at
     RETURNING notice_id`,
  ).bind(retry, recent, now.toISOString()).first<{ notice_id: string }>();
  if (!notice) return;

  const source = await env.DB.prepare(
    "SELECT title, link FROM notices WHERE notice_id = ?1",
  ).bind(notice.notice_id).first<{ title: string; link: string }>();
  if (!source) return;
  const response = await fetch(
    `https://api.github.com/repos/${repository}/actions/workflows/publish-notices.yml/dispatches`, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2026-03-10",
        "User-Agent": "kisa-notice-worker",
      },
      body: JSON.stringify({
        ref: "main", inputs: { notice_url: source.link, notice_title: source.title },
      }),
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    },
  );
  await response.body?.cancel();
  if (!response.ok) throw new Error(`GitHub dispatch returned HTTP ${response.status}.`);
}

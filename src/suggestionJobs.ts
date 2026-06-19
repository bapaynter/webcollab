import type { Database } from "./db.js";

export type SuggestionJobAction = "edit" | "create";
export type SuggestionJobState = "queued" | "running" | "accepted" | "rejected" | "failed" | "pruned";

export interface SuggestionJob {
  readonly id: number;
  readonly request_id: string;
  readonly path: string;
  readonly new_path: string | null;
  readonly message: string;
  readonly ip_hash: string;
  readonly action: SuggestionJobAction;
  readonly change_summary: string;
  readonly state: SuggestionJobState;
  readonly result_reason: string | null;
  readonly result_summary: string | null;
  readonly result_version: number | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly started_at: string | null;
  readonly finished_at: string | null;
  readonly attempts: number;
}

export interface EnqueueJobInput {
  readonly requestId: string;
  readonly path: string;
  readonly newPath: string | null;
  readonly message: string;
  readonly ipHash: string;
  readonly action: SuggestionJobAction;
  readonly changeSummary: string;
}

export function enqueueSuggestionJob(db: Database, input: EnqueueJobInput): SuggestionJob {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO suggestion_jobs
      (request_id, path, new_path, message, ip_hash, action, change_summary, state, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
  ).run(
    input.requestId,
    input.path,
    input.newPath,
    input.message,
    input.ipHash,
    input.action,
    input.changeSummary,
    now,
    now,
  );
  const row = getSuggestionJobByRequestId(db, input.requestId);
  if (row === null) {
    throw new Error(`failed to load queued job ${input.requestId}`);
  }
  return row;
}

export function claimNextQueuedSuggestionJob(db: Database): SuggestionJob | null {
  const claim = db.transaction((): SuggestionJob | null => {
    const next = db
      .prepare(
        `SELECT id, request_id, path, new_path, message, ip_hash, action, change_summary, state,
                result_reason, result_summary, result_version, created_at, updated_at, started_at, finished_at, attempts
           FROM suggestion_jobs
           WHERE state = 'queued'
           ORDER BY created_at ASC, id ASC
           LIMIT 1`,
      )
      .get() as SuggestionJob | undefined;
    if (next === undefined) {
      return null;
    }
    const now = new Date().toISOString();
    const result = db
      .prepare(
        `UPDATE suggestion_jobs
         SET state = 'running', started_at = ?, updated_at = ?, attempts = attempts + 1
         WHERE id = ? AND state = 'queued'`,
      )
      .run(now, now, next.id);
    if (result.changes !== 1) {
      return null;
    }
    return db
      .prepare(
        `SELECT id, request_id, path, new_path, message, ip_hash, action, change_summary, state,
                result_reason, result_summary, result_version, created_at, updated_at, started_at, finished_at, attempts
           FROM suggestion_jobs
           WHERE id = ?`,
      )
      .get(next.id) as SuggestionJob;
  });
  return claim();
}

export function markSuggestionJobAccepted(
  db: Database,
  requestId: string,
  summary: string,
  version: number,
): void {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE suggestion_jobs
     SET state = 'accepted', result_summary = ?, result_version = ?, result_reason = NULL,
         updated_at = ?, finished_at = ?
     WHERE request_id = ?`,
  ).run(summary, version, now, now, requestId);
}

export function markSuggestionJobRejected(db: Database, requestId: string, reason: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE suggestion_jobs
     SET state = 'rejected', result_reason = ?, updated_at = ?, finished_at = ?
     WHERE request_id = ?`,
  ).run(reason, now, now, requestId);
}

export function markSuggestionJobFailed(db: Database, requestId: string, reason: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE suggestion_jobs
     SET state = 'failed', result_reason = ?, updated_at = ?, finished_at = ?
     WHERE request_id = ?`,
  ).run(reason, now, now, requestId);
}

export function getSuggestionJobByRequestId(db: Database, requestId: string): SuggestionJob | null {
  const row = db
    .prepare(
      `SELECT id, request_id, path, new_path, message, ip_hash, action, change_summary, state,
              result_reason, result_summary, result_version, created_at, updated_at, started_at, finished_at, attempts
         FROM suggestion_jobs
         WHERE request_id = ?`,
    )
    .get(requestId) as SuggestionJob | undefined;
  return row ?? null;
}

export function pruneOldSuggestionJobs(db: Database, retentionDays: number): number {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const result = db
    .prepare(
      `UPDATE suggestion_jobs
       SET state = 'pruned', updated_at = ?
       WHERE state IN ('accepted', 'rejected', 'failed') AND finished_at IS NOT NULL AND finished_at < ?`,
    )
    .run(new Date().toISOString(), cutoff);
  return result.changes;
}

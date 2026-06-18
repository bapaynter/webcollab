import type { Database } from "./db.js";

export interface EditRecord {
  readonly id: number;
  readonly page_id: number;
  readonly version: number;
  readonly user_suggestion: string;
  readonly validator_reasoning: string | null;
  readonly validator_change_summary: string | null;
  readonly previous_html: string;
  readonly new_html: string;
  readonly ip_hash: string;
  readonly created_at: string;
}

export interface EditInsert {
  readonly page_id: number;
  readonly version: number;
  readonly user_suggestion: string;
  readonly validator_reasoning: string | null;
  readonly validator_change_summary: string | null;
  readonly previous_html: string;
  readonly new_html: string;
  readonly ip_hash: string;
}

export interface RecentEdit {
  readonly path: string;
  readonly version: number;
  readonly summary: string | null;
  readonly created_at: string;
}

export interface ScopedRecentEdit {
  readonly version: number;
  readonly summary: string | null;
  readonly created_at: string;
}

export interface FullEdit {
  readonly path: string;
  readonly version: number;
  readonly created_at: string;
  readonly summary: string | null;
  readonly user_suggestion: string;
}

export function recordEdit(db: Database, edit: EditInsert): number {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO edits
        (page_id, version, user_suggestion, validator_reasoning, validator_change_summary, previous_html, new_html, ip_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      edit.page_id,
      edit.version,
      edit.user_suggestion,
      edit.validator_reasoning,
      edit.validator_change_summary,
      edit.previous_html,
      edit.new_html,
      edit.ip_hash,
      now,
    );
  return Number(result.lastInsertRowid);
}

export function listEdits(db: Database, pageId: number): ReadonlyArray<EditRecord> {
  return db
    .prepare(
      `SELECT id, page_id, version, user_suggestion, validator_reasoning, validator_change_summary,
              previous_html, new_html, ip_hash, created_at
         FROM edits
         WHERE page_id = ?
         ORDER BY version ASC`,
    )
    .all(pageId) as EditRecord[];
}

export function getEditAtVersion(db: Database, pageId: number, version: number): EditRecord | null {
  const row = db
    .prepare(
      `SELECT id, page_id, version, user_suggestion, validator_reasoning, validator_change_summary,
              previous_html, new_html, ip_hash, created_at
         FROM edits
         WHERE page_id = ? AND version = ?`,
    )
    .get(pageId, version) as EditRecord | undefined;
  return row ?? null;
}

export function listRecentEdits(db: Database, limit: number): ReadonlyArray<RecentEdit> {
  return db
    .prepare(
      `SELECT p.path AS path, e.version AS version, e.validator_change_summary AS summary, e.created_at AS created_at
         FROM edits e
         JOIN pages p ON p.id = e.page_id
         ORDER BY e.created_at DESC, e.id DESC
         LIMIT ?`,
    )
    .all(limit) as RecentEdit[];
}

export function listRecentEditsForPage(
  db: Database,
  pageId: number,
  limit: number,
): ReadonlyArray<ScopedRecentEdit> {
  return db
    .prepare(
      `SELECT version, validator_change_summary AS summary, created_at
         FROM edits
         WHERE page_id = ?
         ORDER BY version DESC
         LIMIT ?`,
    )
    .all(pageId, limit) as ScopedRecentEdit[];
}

export function listAllEdits(db: Database): ReadonlyArray<FullEdit> {
  return db
    .prepare(
      `SELECT p.path AS path, e.version AS version, e.created_at AS created_at,
              e.validator_change_summary AS summary, e.user_suggestion AS user_suggestion
         FROM edits e
         JOIN pages p ON p.id = e.page_id
         ORDER BY e.created_at DESC, e.id DESC`,
    )
    .all() as FullEdit[];
}

import type { Database } from "./db.js";
import { validatePathFormat } from "./pathPolicy.js";

export interface Page {
  readonly id: number;
  readonly path: string;
  readonly current_html: string;
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
}

export function getPageByPath(db: Database, path: string): Page | null {
  const row = db
    .prepare("SELECT id, path, current_html, version, created_at, updated_at FROM pages WHERE path = ?")
    .get(path) as Page | undefined;
  return row ?? null;
}

export function pageExists(db: Database, path: string): boolean {
  const row = db.prepare("SELECT 1 AS one FROM pages WHERE path = ?").get(path) as { one: number } | undefined;
  return row !== undefined;
}

export function createPage(db: Database, path: string, html: string): number {
  const format = validatePathFormat(path);
  if (!format.ok) {
    throw new Error(format.reason);
  }
  const now = new Date().toISOString();
  const result = db
    .prepare("INSERT INTO pages (path, current_html, version, created_at, updated_at) VALUES (?, ?, 0, ?, ?)")
    .run(path, html, now, now);
  return Number(result.lastInsertRowid);
}

export function updatePageHtml(db: Database, pageId: number, html: string): void {
  const now = new Date().toISOString();
  db.prepare("UPDATE pages SET current_html = ?, version = version + 1, updated_at = ? WHERE id = ?").run(
    html,
    now,
    pageId,
  );
}

export function listPages(db: Database): ReadonlyArray<Page> {
  return db
    .prepare("SELECT id, path, current_html, version, created_at, updated_at FROM pages ORDER BY path")
    .all() as Page[];
}

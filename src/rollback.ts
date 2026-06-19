import type { Database } from "./db.js";
import { getPageByPath } from "./pages.js";
import { listEdits } from "./edits.js";

export function rollbackPage(db: Database, pagePath: string, editsToUndo: number): void {
  const page = getPageByPath(db, pagePath);
  if (page === null) {
    throw new Error(`page not found: ${pagePath}`);
  }
  const edits = listEdits(db, page.id);
  if (editsToUndo <= 0) {
    return;
  }
  if (editsToUndo > edits.length) {
    throw new Error(`cannot rollback ${editsToUndo} edits; page has only ${edits.length}`);
  }
  const targetVersion = page.version - editsToUndo;
  let targetHtml: string;
  if (targetVersion === 0) {
    const oldestEdit = edits[0];
    if (oldestEdit === undefined) {
      throw new Error("target edit not found for rollback to seed");
    }
    targetHtml = oldestEdit.previous_html;
  } else {
    const targetEdit = edits.find((e) => e.version === targetVersion);
    if (targetEdit === undefined) {
      throw new Error(`target edit not found for version ${targetVersion}`);
    }
    targetHtml = targetEdit.new_html;
  }
  const now = new Date().toISOString();
  db.prepare("UPDATE pages SET current_html = ?, version = ?, updated_at = ? WHERE id = ?").run(
    targetHtml,
    targetVersion,
    now,
    page.id,
  );
}

export function rollbackToSeed(db: Database, pagePath: string): void {
  const page = getPageByPath(db, pagePath);
  if (page === null) {
    throw new Error(`page not found: ${pagePath}`);
  }
  const edits = listEdits(db, page.id);
  rollbackPage(db, pagePath, edits.length);
}

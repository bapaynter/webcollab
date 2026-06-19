import { describe, it, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { initDb, type Database } from "../src/db.js";

describe("db", () => {
  let db: Database;

  beforeEach(() => {
    db = initDb(":memory:");
  });

  it("creates pages, edits, rate_limits, suggestion_jobs tables", () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    assert.ok(names.includes("pages"));
    assert.ok(names.includes("edits"));
    assert.ok(names.includes("rate_limits"));
    assert.ok(names.includes("suggestion_jobs"));
  });

  it("pages table has expected columns", () => {
    const cols = db.prepare("PRAGMA table_info(pages)").all() as Array<{ name: string }>;
    const colNames = cols.map((c) => c.name);
    for (const expected of ["id", "path", "current_html", "version", "created_at", "updated_at"]) {
      assert.ok(colNames.includes(expected), `expected column ${expected}`);
    }
  });

  it("edits table has UNIQUE(page_id, version) constraint", () => {
    const rows = db
      .prepare("SELECT sql FROM sqlite_master WHERE tbl_name='edits'")
      .all() as Array<{ sql: string | null }>;
    const hasUnique = rows.some(
      (r) =>
        r.sql !== null &&
        r.sql.includes("UNIQUE") &&
        r.sql.includes("page_id") &&
        r.sql.includes("version"),
    );
    assert.ok(hasUnique, "expected UNIQUE(page_id, version) on edits");
  });
});

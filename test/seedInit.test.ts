import { describe, it, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { initDb } from "../src/db.js";
import { ensureSeed } from "../src/seedInit.js";
import { getPageByPath } from "../src/pages.js";

describe("seedInit", () => {
  let db: ReturnType<typeof initDb>;

  beforeEach(() => {
    db = initDb(":memory:");
  });

  it("creates root page on empty DB", () => {
    ensureSeed(db, "/");
    const page = getPageByPath(db, "/");
    assert.ok(page);
    assert.equal(page.version, 0);
  });

  it("is idempotent on existing page", () => {
    ensureSeed(db, "/");
    ensureSeed(db, "/");
    const pages = db.prepare("SELECT COUNT(*) AS c FROM pages WHERE path = '/'").get() as { c: number };
    assert.equal(pages.c, 1);
  });
});

import { describe, it, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { initDb } from "../src/db.js";
import { createPage, getPageByPath, updatePageHtml } from "../src/pages.js";
import { recordEdit, getEditAtVersion, listEdits } from "../src/edits.js";
import { rollbackPage, rollbackToSeed } from "../src/rollback.js";

describe("rollback", () => {
  let db: ReturnType<typeof initDb>;

  beforeEach(() => {
    db = initDb(":memory:");
  });

  function makePageWithEdits() {
    createPage(db, "/foo", "<p>v0</p>");
    const page = getPageByPath(db, "/foo");
    if (page === null) throw new Error("setup");
    for (const v of [1, 2, 3]) {
      const prior = getEditAtVersion(db, page.id, v - 1);
      const previousHtml = prior !== null ? prior.new_html : page.current_html;
      updatePageHtml(db, page.id, `<p>v${v}</p>`);
      const after = getPageByPath(db, "/foo");
      if (after === null) throw new Error("setup");
      recordEdit(db, {
        page_id: page.id,
        version: v,
        user_suggestion: `s${v}`,
        validator_reasoning: null,
        validator_change_summary: `sum${v}`,
        previous_html: previousHtml,
        new_html: `<p>v${v}</p>`,
        ip_hash: "h",
      });
    }
    return page.id;
  }

  it("rolls back 1 edit", () => {
    const pageId = makePageWithEdits();
    rollbackPage(db, "/foo", 1);
    const page = getPageByPath(db, "/foo");
    assert.ok(page);
    assert.equal(page.version, 2);
    assert.match(page.current_html, /v2/);
  });

  it("rolls back 3 edits to v0 (seed)", () => {
    const pageId = makePageWithEdits();
    rollbackPage(db, "/foo", 3);
    const page = getPageByPath(db, "/foo");
    assert.ok(page);
    assert.equal(page.version, 0);
    assert.match(page.current_html, /v0/);
  });

  it("rollbackToSeed works for large N", () => {
    const pageId = makePageWithEdits();
    rollbackToSeed(db, "/foo");
    const page = getPageByPath(db, "/foo");
    assert.ok(page);
    assert.equal(page.version, 0);
  });

  it("leaves edit log intact (does not delete rows)", () => {
    const pageId = makePageWithEdits();
    rollbackPage(db, "/foo", 1);
    const edits = listEdits(db, pageId);
    assert.equal(edits.length, 3);
  });

  it("throws when target edit row is missing", () => {
    createPage(db, "/foo", "<p>v0</p>");
    const page = getPageByPath(db, "/foo");
    if (page === null) {
      throw new Error("setup");
    }
    updatePageHtml(db, page.id, "<p>v1</p>");
    updatePageHtml(db, page.id, "<p>v2</p>");
    recordEdit(db, {
      page_id: page.id,
      version: 2,
      user_suggestion: "s2",
      validator_reasoning: null,
      validator_change_summary: "sum2",
      previous_html: "<p>v1</p>",
      new_html: "<p>v2</p>",
      ip_hash: "h",
    });
    assert.throws(() => rollbackPage(db, "/foo", 1), /target edit not found/i);
  });
});

import { describe, it, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { initDb } from "../src/db.js";
import { createPage, getPageByPath } from "../src/pages.js";
import { recordEdit, listEdits, getEditAtVersion, listRecentEdits, listAllEdits } from "../src/edits.js";

describe("edits", () => {
  let db: ReturnType<typeof initDb>;

  beforeEach(() => {
    db = initDb(":memory:");
  });

  describe("recordEdit", () => {
    it("writes a row and returns its id", () => {
      createPage(db, "/foo", "<p>v0</p>");
      const page = getPageByPath(db, "/foo");
      assert.ok(page);
      const editId = recordEdit(db, {
        page_id: page.id,
        version: 1,
        user_suggestion: "add a heading",
        validator_reasoning: "ok",
        validator_change_summary: "added h1",
        previous_html: page.current_html,
        new_html: "<h1>hi</h1><p>v0</p>",
        ip_hash: "abc123",
      });
      assert.ok(editId > 0);
    });

    it("enforces UNIQUE(page_id, version)", () => {
      createPage(db, "/foo", "<p>v0</p>");
      const page = getPageByPath(db, "/foo");
      assert.ok(page);
      recordEdit(db, {
        page_id: page.id,
        version: 1,
        user_suggestion: "x",
        validator_reasoning: null,
        validator_change_summary: null,
        previous_html: page.current_html,
        new_html: "<p>v1</p>",
        ip_hash: "h",
      });
      assert.throws(() =>
        recordEdit(db, {
          page_id: page.id,
          version: 1,
          user_suggestion: "x",
          validator_reasoning: null,
          validator_change_summary: null,
          previous_html: page.current_html,
          new_html: "<p>v1b</p>",
          ip_hash: "h",
        }),
      );
    });
  });

  describe("listEdits", () => {
    it("returns empty array for page with no edits", () => {
      createPage(db, "/foo", "<p>v0</p>");
      const page = getPageByPath(db, "/foo");
      assert.ok(page);
      assert.deepEqual(listEdits(db, page.id), []);
    });

    it("returns edits in version order", () => {
      createPage(db, "/foo", "<p>v0</p>");
      const page = getPageByPath(db, "/foo");
      assert.ok(page);
      for (const v of [1, 2, 3]) {
        recordEdit(db, {
          page_id: page.id,
          version: v,
          user_suggestion: `s${v}`,
          validator_reasoning: null,
          validator_change_summary: `summary ${v}`,
          previous_html: `<p>v${v - 1}</p>`,
          new_html: `<p>v${v}</p>`,
          ip_hash: "h",
        });
      }
      const edits = listEdits(db, page.id);
      assert.equal(edits.length, 3);
      assert.equal(edits[0]?.version, 1);
      assert.equal(edits[1]?.version, 2);
      assert.equal(edits[2]?.version, 3);
    });
  });

  describe("getEditAtVersion", () => {
    it("returns null for missing version", () => {
      createPage(db, "/foo", "<p>v0</p>");
      const page = getPageByPath(db, "/foo");
      assert.ok(page);
      assert.equal(getEditAtVersion(db, page.id, 5), null);
    });

    it("returns the edit at the requested version", () => {
      createPage(db, "/foo", "<p>v0</p>");
      const page = getPageByPath(db, "/foo");
      assert.ok(page);
      recordEdit(db, {
        page_id: page.id,
        version: 1,
        user_suggestion: "x",
        validator_reasoning: null,
        validator_change_summary: "first edit",
        previous_html: "<p>v0</p>",
        new_html: "<p>v1</p>",
        ip_hash: "h",
      });
      const edit = getEditAtVersion(db, page.id, 1);
      assert.ok(edit);
      assert.equal(edit.validator_change_summary, "first edit");
    });
  });

  describe("listRecentEdits", () => {
    it("returns last N edits across all pages, newest first", () => {
      createPage(db, "/a", "<p>a0</p>");
      createPage(db, "/b", "<p>b0</p>");
      const pageA = getPageByPath(db, "/a");
      const pageB = getPageByPath(db, "/b");
      assert.ok(pageA);
      assert.ok(pageB);
      recordEdit(db, {
        page_id: pageA.id,
        version: 1,
        user_suggestion: "a1",
        validator_reasoning: null,
        validator_change_summary: "a1sum",
        previous_html: "<p>a0</p>",
        new_html: "<p>a1</p>",
        ip_hash: "h",
      });
      recordEdit(db, {
        page_id: pageB.id,
        version: 1,
        user_suggestion: "b1",
        validator_reasoning: null,
        validator_change_summary: "b1sum",
        previous_html: "<p>b0</p>",
        new_html: "<p>b1</p>",
        ip_hash: "h",
      });
      const recent = listRecentEdits(db, 10);
      assert.equal(recent.length, 2);
      assert.equal(recent[0]?.path, "/b");
      assert.equal(recent[1]?.path, "/a");
    });

    it("respects limit", () => {
      createPage(db, "/a", "<p>a0</p>");
      const pageA = getPageByPath(db, "/a");
      assert.ok(pageA);
      for (let v = 1; v <= 5; v++) {
        recordEdit(db, {
          page_id: pageA.id,
          version: v,
          user_suggestion: `${v}`,
          validator_reasoning: null,
          validator_change_summary: `sum${v}`,
          previous_html: `<p>v${v - 1}</p>`,
          new_html: `<p>v${v}</p>`,
          ip_hash: "h",
        });
      }
      const recent = listRecentEdits(db, 2);
      assert.equal(recent.length, 2);
      assert.equal(recent[0]?.version, 5);
      assert.equal(recent[1]?.version, 4);
    });
  });

  describe("listAllEdits", () => {
    it("returns full history across pages, newest first", () => {
      createPage(db, "/a", "<p>a0</p>");
      createPage(db, "/b", "<p>b0</p>");
      const pageA = getPageByPath(db, "/a");
      const pageB = getPageByPath(db, "/b");
      assert.ok(pageA);
      assert.ok(pageB);
      recordEdit(db, {
        page_id: pageA.id,
        version: 1,
        user_suggestion: "a1",
        validator_reasoning: null,
        validator_change_summary: "a1sum",
        previous_html: "<p>a0</p>",
        new_html: "<p>a1</p>",
        ip_hash: "h",
      });
      recordEdit(db, {
        page_id: pageB.id,
        version: 1,
        user_suggestion: "b1",
        validator_reasoning: null,
        validator_change_summary: "b1sum",
        previous_html: "<p>b0</p>",
        new_html: "<p>b1</p>",
        ip_hash: "h",
      });
      const all = listAllEdits(db);
      assert.equal(all.length, 2);
      assert.equal(all[0]?.path, "/b");
      assert.equal(all[1]?.path, "/a");
      assert.equal(all[0]?.summary, "b1sum");
      assert.equal(all[0]?.user_suggestion, "b1");
    });

    it("returns empty array when no edits exist", () => {
      createPage(db, "/a", "<p>a0</p>");
      assert.deepEqual(listAllEdits(db), []);
    });
  });
});

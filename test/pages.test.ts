import { describe, it, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { initDb } from "../src/db.js";
import { getPageByPath, createPage, updatePageHtml, listPages, pageExists } from "../src/pages.js";
import { validatePathFormat } from "../src/pathPolicy.js";

describe("pages", () => {
  let db: ReturnType<typeof initDb>;

  beforeEach(() => {
    db = initDb(":memory:");
  });

  describe("createPage", () => {
    it("creates a page and returns its id", () => {
      const id = createPage(db, "/", "<p>hi</p>");
      assert.ok(typeof id === "number" && id > 0);
    });

    it("rejects invalid path formats", () => {
      assert.throws(() => createPage(db, "no-slash", "<p>hi</p>"));
      assert.throws(() => createPage(db, "/foo/", "<p>hi</p>"));
      assert.throws(() => createPage(db, "", "<p>hi</p>"));
    });

    it("starts version at 0", () => {
      createPage(db, "/foo", "<p>hi</p>");
      const page = getPageByPath(db, "/foo");
      assert.ok(page);
      assert.equal(page.version, 0);
    });

    it("sets created_at and updated_at", () => {
      createPage(db, "/foo", "<p>hi</p>");
      const page = getPageByPath(db, "/foo");
      assert.ok(page);
      assert.ok(page.created_at);
      assert.ok(page.updated_at);
    });
  });

  describe("getPageByPath", () => {
    it("returns null for unknown path", () => {
      assert.equal(getPageByPath(db, "/nope"), null);
    });

    it("returns the page when it exists", () => {
      createPage(db, "/foo", "<p>hi</p>");
      const page = getPageByPath(db, "/foo");
      assert.ok(page);
      assert.equal(page.path, "/foo");
      assert.equal(page.current_html, "<p>hi</p>");
    });
  });

  describe("updatePageHtml", () => {
    it("bumps version by 1", () => {
      createPage(db, "/foo", "<p>v0</p>");
      const before = getPageByPath(db, "/foo");
      assert.ok(before);
      updatePageHtml(db, before.id, "<p>v1</p>");
      const after = getPageByPath(db, "/foo");
      assert.ok(after);
      assert.equal(after.version, 1);
      assert.equal(after.current_html, "<p>v1</p>");
    });

    it("updates updated_at", () => {
      createPage(db, "/foo", "<p>hi</p>");
      const before = getPageByPath(db, "/foo");
      assert.ok(before);
      const originalUpdatedAt = before.updated_at;
      return new Promise<void>((resolvePromise) => {
        setTimeout(() => {
          updatePageHtml(db, before.id, "<p>updated</p>");
          const after = getPageByPath(db, "/foo");
          assert.ok(after);
          assert.ok(after.updated_at >= originalUpdatedAt);
          resolvePromise();
        }, 5);
      });
    });
  });

  describe("listPages", () => {
    it("returns empty array for empty DB", () => {
      assert.deepEqual(listPages(db), []);
    });

    it("returns all pages", () => {
      createPage(db, "/", "<p>root</p>");
      createPage(db, "/foo", "<p>foo</p>");
      createPage(db, "/bar", "<p>bar</p>");
      const pages = listPages(db);
      assert.equal(pages.length, 3);
      const paths = pages.map((p) => p.path).sort();
      assert.deepEqual(paths, ["/", "/bar", "/foo"]);
    });
  });

  describe("pageExists", () => {
    it("returns false for unknown", () => {
      assert.equal(pageExists(db, "/nope"), false);
    });
    it("returns true for known", () => {
      createPage(db, "/foo", "<p>hi</p>");
      assert.equal(pageExists(db, "/foo"), true);
    });
  });

  it("validatePathFormat contract holds for paths we accept", () => {
    assert.equal(validatePathFormat("/foo").ok, true);
    assert.equal(validatePathFormat("/foo/bar/baz").ok, true);
  });
});

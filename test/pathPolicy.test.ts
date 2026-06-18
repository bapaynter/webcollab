import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { checkDepth, validatePathFormat, MAX_PAGE_DEPTH } from "../src/pathPolicy.js";

describe("pathPolicy", () => {
  describe("checkDepth", () => {
    it("allows root", () => {
      assert.deepEqual(checkDepth("/"), { ok: true });
    });

    it("allows depth 1 through 4", () => {
      assert.equal(checkDepth("/a").ok, true);
      assert.equal(checkDepth("/a/b").ok, true);
      assert.equal(checkDepth("/a/b/c").ok, true);
      assert.equal(checkDepth("/a/b/c/d").ok, true);
    });

    it("rejects depth 5", () => {
      const result = checkDepth("/a/b/c/d/e");
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.match(result.reason, /depth/);
      }
    });

    it("uses MAX_PAGE_DEPTH constant", () => {
      assert.equal(MAX_PAGE_DEPTH, 4);
    });
  });

  describe("validatePathFormat", () => {
    it("accepts /", () => {
      assert.equal(validatePathFormat("/").ok, true);
    });

    it("accepts /foo, /foo/bar", () => {
      assert.equal(validatePathFormat("/foo").ok, true);
      assert.equal(validatePathFormat("/foo/bar").ok, true);
    });

    it("rejects path without leading slash", () => {
      const result = validatePathFormat("foo");
      assert.equal(result.ok, false);
    });

    it("rejects path with invalid characters", () => {
      assert.equal(validatePathFormat("/foo bar").ok, false);
      assert.equal(validatePathFormat("/foo!bar").ok, false);
      assert.equal(validatePathFormat("/Foo").ok, false);
    });

    it("rejects trailing slash (except root)", () => {
      assert.equal(validatePathFormat("/foo/").ok, false);
    });

    it("rejects empty path", () => {
      assert.equal(validatePathFormat("").ok, false);
    });

    it("rejects path with consecutive slashes", () => {
      assert.equal(validatePathFormat("/foo//bar").ok, false);
    });
  });
});

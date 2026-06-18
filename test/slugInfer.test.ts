import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { extract, MAX_SLUG_LENGTH } from "../src/slugInfer.js";
import { MAX_PAGE_DEPTH } from "../src/pathPolicy.js";

describe("slugInfer", () => {
  it("infers slug from 'add a gallery' on /foo", () => {
    const result = extract("add a gallery", "/foo");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.slug, "gallery");
      assert.equal(result.value.path, "/foo/gallery");
    }
  });

  it("infers slug from 'make a thing called widget'", () => {
    const result = extract("make a thing called widget", "/");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.slug, "widget");
      assert.equal(result.value.path, "/widget");
    }
  });

  it("infers slug from 'create a page for blog'", () => {
    const result = extract("create a page for blog", "/");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.slug, "blog");
    }
  });

  it("strips leading slash from explicit /<slug>", () => {
    const result = extract("make a /about page", "/foo");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.slug, "about");
      assert.equal(result.value.path, "/foo/about");
    }
  });

  it("strips leading slash from 'called /about'", () => {
    const result = extract("add a page called /about", "/foo");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.slug, "about");
      assert.equal(result.value.path, "/foo/about");
    }
  });

  it("rejects when no slug can be inferred", () => {
    const result = extract("just change the color", "/foo");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.reason, /no slug/i);
    }
  });

  it("rejects when path would exceed MAX_PAGE_DEPTH", () => {
    const deepPath = "/a/b/c/d";
    const result = extract("add a gallery", deepPath);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.reason, /depth/i);
    }
    assert.equal(MAX_PAGE_DEPTH, 4);
  });

  it("truncates slug to MAX_SLUG_LENGTH", () => {
    const longWord = "a".repeat(50);
    const result = extract(`add a ${longWord}`, "/");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(result.value.slug.length <= MAX_SLUG_LENGTH);
    }
  });
});

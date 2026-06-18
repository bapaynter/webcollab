import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { verify } from "../src/linkGuard.js";

describe("linkGuard", () => {
  it("passes when parent has matching <a href>", () => {
    const html = `<main><h1>x</h1><a href="/foo/bar">go</a></main>`;
    const result = verify(html, "/foo", "/foo/bar");
    assert.equal(result.ok, true);
  });

  it("passes with relative href that resolves to target", () => {
    const html = `<main><h1>x</h1><a href="bar">go</a></main>`;
    const result = verify(html, "/foo", "/foo/bar");
    assert.equal(result.ok, true);
  });

  it("fails when no <a> exists", () => {
    const html = `<main><h1>x</h1></main>`;
    const result = verify(html, "/foo", "/foo/bar");
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.reason, /no anchor/);
  });

  it("fails when <a> exists but href doesn't match", () => {
    const html = `<main><a href="/other">x</a></main>`;
    const result = verify(html, "/foo", "/foo/bar");
    assert.equal(result.ok, false);
  });

  it("ignores <link> tags (only counts <a>)", () => {
    const html = `<head><link rel="stylesheet" href="/foo/bar"></head><main></main>`;
    const result = verify(html, "/foo", "/foo/bar");
    assert.equal(result.ok, false);
  });
});

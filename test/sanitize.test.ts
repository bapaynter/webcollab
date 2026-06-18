import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { sanitizeHTML, MAX_ELEMENTS_ADDED } from "../src/sanitize.js";
import { SEED_ROOT_HTML } from "../src/seed.js";

describe("sanitize", () => {
  describe("strips dangerous content", () => {
    it("strips <script>", () => {
      const out = sanitizeHTML("<p>hi</p><script>alert(1)</script>");
      assert.ok(!/<script/i.test(out));
      assert.match(out, /<p>hi<\/p>/);
    });

    it("strips <style>", () => {
      const out = sanitizeHTML("<style>body{}</style><p>hi</p>");
      assert.ok(!/<style/i.test(out));
    });

    it("strips <iframe>", () => {
      const out = sanitizeHTML("<iframe src='x'></iframe><p>hi</p>");
      assert.ok(!/<iframe/i.test(out));
    });

    it("strips <form> and <input>", () => {
      const out = sanitizeHTML("<form><input></form><p>hi</p>");
      assert.ok(!/<form/i.test(out));
      assert.ok(!/<input/i.test(out));
    });

    it("strips event handler attributes", () => {
      const out = sanitizeHTML('<p onclick="x">hi</p>');
      assert.ok(!/onclick/i.test(out));
    });

    it("strips javascript: URLs in href", () => {
      const out = sanitizeHTML('<a href="javascript:alert(1)">x</a>');
      assert.ok(!/javascript:/i.test(out));
    });

    it("strips data:text/html URLs in src", () => {
      const out = sanitizeHTML('<img src="data:text/html,<script>">');
      assert.ok(!/data:text\/html/i.test(out));
    });

    it("strips data: URLs in href", () => {
      const out = sanitizeHTML('<a href="data:text/html,x">y</a>');
      assert.ok(!/data:text\/html/i.test(out));
    });
  });

  describe("preserves safe content", () => {
    it("preserves <p>, <h1>, <a href=/path>", () => {
      const out = sanitizeHTML('<h1>title</h1><p>hi <a href="/foo">link</a></p>');
      assert.match(out, /<h1>title<\/h1>/);
      assert.match(out, /<p>hi/);
      assert.match(out, /href="\/foo"/);
    });

    it("preserves https: URLs in img src", () => {
      const out = sanitizeHTML('<img src="https://example.com/x.png" alt="x">');
      assert.match(out, /<img/);
      assert.match(out, /src="https:\/\/example\.com\/x\.png"/);
    });

    it("preserves inline style attribute on safe elements", () => {
      const out = sanitizeHTML('<p style="color: red; font-size: 1.5rem">hi</p>');
      assert.match(out, /style="[^"]*color:\s*red/);
      assert.match(out, /style="[^"]*font-size:\s*1\.5rem/);
    });
  });

  describe("inline style sanitization", () => {
    it("strips javascript: URLs from style values", () => {
      const out = sanitizeHTML('<p style="background: url(javascript:alert(1))">x</p>');
      assert.ok(!/javascript:/i.test(out), `output: ${out}`);
    });

    it("strips expression() from style values", () => {
      const out = sanitizeHTML('<p style="width: expression(alert(1))">x</p>');
      assert.ok(!/expression\(/i.test(out), `output: ${out}`);
    });

    it("strips @import from style values", () => {
      const out = sanitizeHTML('<p style="@import url(evil.css)">x</p>');
      assert.ok(!/@import/i.test(out), `output: ${out}`);
    });
  });

  describe("structural guards", () => {
    it("MAX_ELEMENTS_ADDED is exposed", () => {
      assert.ok(MAX_ELEMENTS_ADDED > 0);
    });
  });

  describe("full document preservation", () => {
    it("preserves DOCTYPE, html, head, body structure", () => {
      const out = sanitizeHTML(SEED_ROOT_HTML);
      assert.match(out, /<!doctype html>/i);
      assert.match(out, /<html/);
      assert.match(out, /<head>/);
      assert.match(out, /<body>/);
    });

    it("preserves meta charset and viewport", () => {
      const out = sanitizeHTML(SEED_ROOT_HTML);
      assert.match(out, /<meta[^>]*charset/i);
      assert.match(out, /<meta[^>]*viewport/i);
    });

    it("preserves link stylesheet", () => {
      const out = sanitizeHTML(SEED_ROOT_HTML);
      assert.match(out, /<link[^>]*stylesheet/i);
    });

    it("preserves title element", () => {
      const out = sanitizeHTML(SEED_ROOT_HTML);
      assert.match(out, /<title>Canvas<\/title>/);
    });

    it("preserves body content (h1, p)", () => {
      const out = sanitizeHTML(SEED_ROOT_HTML);
      assert.match(out, /<h1>Canvas<\/h1>/);
      assert.match(out, /Suggest a change in the chat\./);
    });

    it("strips meta http-equiv even when meta tags are allowed", () => {
      const evil = '<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=evil"></head><body></body></html>';
      const out = sanitizeHTML(evil);
      assert.ok(!/http-equiv/i.test(out), "http-equiv must be stripped");
    });
  });
});

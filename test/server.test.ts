import { describe, it, after } from "node:test";
import { strict as assert } from "node:assert";
import { buildServer, type ServerHandle } from "../src/server.js";
import { createPage } from "../src/pages.js";
import { CONTENT_SECURITY_POLICY } from "../src/seed.js";

describe("server", () => {
  const handles: ServerHandle[] = [];

  after(async () => {
    for (const h of handles) {
      await h.close();
    }
  });

  it("buildServer returns a Fastify instance", () => {
    const handle = buildServer({ dbPath: ":memory:" });
    handles.push(handle);
    assert.ok(handle.fastify);
  });

  it("responds 200 on GET /healthz", async () => {
    const handle = buildServer({ dbPath: ":memory:" });
    handles.push(handle);
    const response = await handle.fastify.inject({ method: "GET", url: "/healthz" });
    assert.equal(response.statusCode, 200);
  });

  describe("GET /<path>", () => {
    it("returns 404 for unknown page", async () => {
      const handle = buildServer({ dbPath: ":memory:" });
      handles.push(handle);
      const response = await handle.fastify.inject({ method: "GET", url: "/nope" });
      assert.equal(response.statusCode, 404);
    });

    it("returns 200 and page HTML for known page", async () => {
      const handle = buildServer({ dbPath: ":memory:" });
      handles.push(handle);
      createPage(handle.db, "/foo", "<main>hi</main>");
      const response = await handle.fastify.inject({ method: "GET", url: "/foo" });
      assert.equal(response.statusCode, 200);
      assert.match(response.body, /<main>hi<\/main>/);
    });

    it("injects widget script into served page", async () => {
      const handle = buildServer({ dbPath: ":memory:" });
      handles.push(handle);
      createPage(handle.db, "/foo", "<main>hi</main>");
      const response = await handle.fastify.inject({ method: "GET", url: "/foo" });
      assert.match(response.body, /<script src="\/widget\.js"[^>]*><\/script>/);
    });

    it("applies Content-Security-Policy header", async () => {
      const handle = buildServer({ dbPath: ":memory:" });
      handles.push(handle);
      createPage(handle.db, "/foo", "<main>hi</main>");
      const response = await handle.fastify.inject({ method: "GET", url: "/foo" });
      assert.equal(response.headers["content-security-policy"], CONTENT_SECURITY_POLICY);
    });

    it("applies X-Frame-Options: DENY", async () => {
      const handle = buildServer({ dbPath: ":memory:" });
      handles.push(handle);
      createPage(handle.db, "/foo", "<main>hi</main>");
      const response = await handle.fastify.inject({ method: "GET", url: "/foo" });
      assert.equal(response.headers["x-frame-options"], "DENY");
    });
  });

  describe("static files", () => {
    it("serves /paper.min.css with text/css content-type", async () => {
      const handle = buildServer({ dbPath: ":memory:" });
      handles.push(handle);
      const response = await handle.fastify.inject({ method: "GET", url: "/paper.min.css" });
      assert.equal(response.statusCode, 200);
      assert.match(response.headers["content-type"] ?? "", /text\/css/);
      assert.ok(response.body.length > 100);
    });

    it("serves /widget.js with application/javascript content-type", async () => {
      const handle = buildServer({ dbPath: ":memory:" });
      handles.push(handle);
      const response = await handle.fastify.inject({ method: "GET", url: "/widget.js" });
      assert.equal(response.statusCode, 200);
      assert.match(response.headers["content-type"] ?? "", /javascript/);
    });
  });

  describe("GET /api/state", () => {
    it("returns pages list and recent edits", async () => {
      const handle = buildServer({ dbPath: ":memory:" });
      handles.push(handle);
      createPage(handle.db, "/", "<p>root</p>");
      createPage(handle.db, "/foo", "<p>foo</p>");
      const response = await handle.fastify.inject({ method: "GET", url: "/api/state" });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body) as { pages: Array<{ path: string }>; recent_edits: unknown[] };
      assert.equal(body.pages.length, 2);
      const paths = body.pages.map((p) => p.path).sort();
      assert.deepEqual(paths, ["/", "/foo"]);
    });

    it("scoped to single path via ?path=", async () => {
      const handle = buildServer({ dbPath: ":memory:" });
      handles.push(handle);
      createPage(handle.db, "/", "<p>root</p>");
      createPage(handle.db, "/foo", "<p>foo</p>");
      const response = await handle.fastify.inject({ method: "GET", url: "/api/state?path=/foo" });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body) as { path: string; version: number };
      assert.equal(body.path, "/foo");
      assert.equal(body.version, 0);
    });
  });
});

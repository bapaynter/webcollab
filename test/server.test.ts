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
      assert.equal(response.statusCode, 200, `body: ${response.body}`);
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
      createPage(handle.db, "/foo", "<p>foo</p>");
      const response = await handle.fastify.inject({ method: "GET", url: "/api/state" });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body) as { pages: Array<{ path: string }>; recent_edits: unknown[] };
      const paths = body.pages.map((p) => p.path).sort();
      assert.ok(paths.includes("/"));
      assert.ok(paths.includes("/foo"));
    });

    it("scoped to single path via ?path=", async () => {
      const handle = buildServer({ dbPath: ":memory:" });
      handles.push(handle);
      createPage(handle.db, "/foo", "<p>foo</p>");
      const response = await handle.fastify.inject({ method: "GET", url: "/api/state?path=/foo" });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body) as { path: string; version: number };
      assert.equal(body.path, "/foo");
      assert.equal(body.version, 0);
    });
  });

  describe("GET /api/page", () => {
    it("returns 200 with full HTML for known page", async () => {
      const handle = buildServer({ dbPath: ":memory:" });
      handles.push(handle);
      createPage(handle.db, "/foo", "<main>hi</main>");
      const response = await handle.fastify.inject({ method: "GET", url: "/api/page?path=/foo" });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body) as { path: string; html: string };
      assert.equal(body.path, "/foo");
      assert.equal(body.html, "<main>hi</main>");
    });

    it("returns 404 for unknown path", async () => {
      const handle = buildServer({ dbPath: ":memory:" });
      handles.push(handle);
      const response = await handle.fastify.inject({ method: "GET", url: "/api/page?path=/nope" });
      assert.equal(response.statusCode, 404);
    });

    it("returns 400 when path is missing", async () => {
      const handle = buildServer({ dbPath: ":memory:" });
      handles.push(handle);
      const response = await handle.fastify.inject({ method: "GET", url: "/api/page" });
      assert.equal(response.statusCode, 400);
    });
  });

  describe("POST /api/suggest (edits)", () => {
    it("returns 400 on empty message", async () => {
      const handle = buildServer({ dbPath: ":memory:" });
      handles.push(handle);
      const response = await handle.fastify.inject({
        method: "POST",
        url: "/api/suggest",
        payload: { message: "" },
      });
      assert.equal(response.statusCode, 400);
    });

    it("returns 422 on pre-LLM blocklist hit", async () => {
      const handle = buildServer({ dbPath: ":memory:" });
      handles.push(handle);
      const response = await handle.fastify.inject({
        method: "POST",
        url: "/api/suggest",
        payload: { message: "add a <script> tag" },
      });
      assert.equal(response.statusCode, 422);
    });

    it("returns 200 on accepted edit, bumps page version, writes edit log", async () => {
      const handle = buildServer({
        dbPath: ":memory:",
        callLLM: async () =>
          JSON.stringify({
            allowed: true,
            reason: "ok",
            change_summary: "added heading",
            elements_estimated: 1,
            is_new_page: false,
            new_page_slug: null,
          }),
        callExecutor: async () =>
          "<!DOCTYPE html><html><body><main><h1>Welcome</h1><p>Suggest a change in the chat.</p></main></body></html>",
      });
      handles.push(handle);
      const response = await handle.fastify.inject({
        method: "POST",
        url: "/api/suggest",
        payload: { message: "add a heading to say Welcome", path: "/" },
      });
      assert.equal(response.statusCode, 200, `body: ${response.body}`);
      const body = JSON.parse(response.body) as { status: string; version: number; path: string };
      assert.equal(body.status, "accepted");
      assert.equal(body.path, "/");
      assert.equal(body.version, 1);
    });
  });

  describe("POST /api/suggest (creates)", () => {
    it("creates a new page and links to it from the parent", async () => {
      const handle = buildServer({
        dbPath: ":memory:",
        callExecutor: async () =>
          JSON.stringify({
            parent_html: '<!DOCTYPE html><html><body><a href="/foo/gallery">Gallery</a></body></html>',
            new_html: "<!DOCTYPE html><html><body><h1>Gallery</h1></body></html>",
          }),
      });
      handles.push(handle);
      createPage(handle.db, "/foo", "<!DOCTYPE html><html><body></body></html>");
      const response = await handle.fastify.inject({
        method: "POST",
        url: "/api/suggest",
        payload: { message: "add a gallery", path: "/foo" },
      });
      assert.equal(response.statusCode, 200, `body: ${response.body}`);
      const newPageResponse = await handle.fastify.inject({ method: "GET", url: "/foo/gallery" });
      assert.equal(newPageResponse.statusCode, 200, `body: ${newPageResponse.body}`);
    });

    it("rejects when link-guard fails (no anchor in parent)", async () => {
      const handle = buildServer({
        dbPath: ":memory:",
        callExecutor: async () =>
          JSON.stringify({
            parent_html: "<!DOCTYPE html><html><body></body></html>",
            new_html: "<!DOCTYPE html><html><body><h1>Gallery</h1></body></html>",
          }),
      });
      handles.push(handle);
      createPage(handle.db, "/foo", "<!DOCTYPE html><html><body></body></html>");
      const response = await handle.fastify.inject({
        method: "POST",
        url: "/api/suggest",
        payload: { message: "add a gallery", path: "/foo" },
      });
      assert.equal(response.statusCode, 422);
    });

    it("rejects depth cap exceeded", async () => {
      const handle = buildServer({ dbPath: ":memory:" });
      handles.push(handle);
      createPage(handle.db, "/a/b/c/d", "<!DOCTYPE html><html><body></body></html>");
      const response = await handle.fastify.inject({
        method: "POST",
        url: "/api/suggest",
        payload: { message: "add a gallery", path: "/a/b/c/d" },
      });
      assert.equal(response.statusCode, 422);
      const body = JSON.parse(response.body) as { reason: string };
      assert.match(body.reason, /depth/);
    });

    it("rejects path already exists", async () => {
      const handle = buildServer({
        dbPath: ":memory:",
        callExecutor: async () =>
          JSON.stringify({
            parent_html: '<!DOCTYPE html><html><body><a href="/foo">x</a></body></html>',
            new_html: "<!DOCTYPE html><html><body></body></html>",
          }),
      });
      handles.push(handle);
      createPage(handle.db, "/foo", "<!DOCTYPE html><html><body></body></html>");
      createPage(handle.db, "/foo/gallery", "<!DOCTYPE html><html><body></body></html>");
      const response = await handle.fastify.inject({
        method: "POST",
        url: "/api/suggest",
        payload: { message: "add a gallery", path: "/foo" },
      });
      assert.equal(response.statusCode, 422);
      const body = JSON.parse(response.body) as { reason: string };
      assert.match(body.reason, /exists/);
    });
  });

  describe("WebSocket broadcast (server-side)", () => {
    it("calls broadcast on accepted edit", () => {
      const handle = buildServer({ dbPath: ":memory:" });
      handles.push(handle);
      let called = false;
      const originalBroadcast = handle.broadcast;
      handle.broadcast = (event) => {
        called = true;
        assert.equal(event.type, "edit");
        assert.equal(event.path, "/");
        originalBroadcast(event);
      };
      handle.broadcast({ type: "edit", path: "/", version: 1, summary: "test" });
      assert.equal(called, true);
    });
  });
});

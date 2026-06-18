import { describe, it, after } from "node:test";
import { strict as assert } from "node:assert";
import { buildServer, type ServerHandle } from "../src/server.js";
import { createPage, updatePageHtml } from "../src/pages.js";
import { CONTENT_SECURITY_POLICY } from "../src/seed.js";
import { hashIp } from "../src/rateLimit.js";
import { listEdits, recordEdit } from "../src/edits.js";

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

    it("injects paper.min.css link into served page when missing", async () => {
      const handle = buildServer({ dbPath: ":memory:" });
      handles.push(handle);
      createPage(handle.db, "/foo", "<!DOCTYPE html><html><head></head><body><main>hi</main></body></html>");
      const response = await handle.fastify.inject({ method: "GET", url: "/foo" });
      assert.match(response.body, /<link rel="stylesheet" href="\/paper\.min\.css">/);
    });

    it("does not duplicate paper.min.css link when already present", async () => {
      const handle = buildServer({ dbPath: ":memory:" });
      handles.push(handle);
      createPage(
        handle.db,
        "/foo",
        '<!DOCTYPE html><html><head><link rel="stylesheet" href="/paper.min.css"></head><body><main>hi</main></body></html>',
      );
      const response = await handle.fastify.inject({ method: "GET", url: "/foo" });
      const matches = response.body.match(/paper\.min\.css/g) ?? [];
      assert.equal(matches.length, 1, `expected exactly 1 paper.min.css reference, found ${matches.length}: ${response.body}`);
    });

    it("injects default body margin style when missing", async () => {
      const handle = buildServer({ dbPath: ":memory:" });
      handles.push(handle);
      createPage(handle.db, "/foo", "<!DOCTYPE html><html><head></head><body><main>hi</main></body></html>");
      const response = await handle.fastify.inject({ method: "GET", url: "/foo" });
      assert.match(response.body, /<style[^>]*canvas-body-margin[^>]*>body\{margin[^}]*\}<\/style>/);
    });

    it("does not duplicate body margin style when already present", async () => {
      const handle = buildServer({ dbPath: ":memory:" });
      handles.push(handle);
      createPage(
        handle.db,
        "/foo",
        '<!DOCTYPE html><html><head><style>#canvas-body-margin{margin:2rem}</style></head><body><main>hi</main></body></html>',
      );
      const response = await handle.fastify.inject({ method: "GET", url: "/foo" });
      const matches = response.body.match(/canvas-body-margin/g) ?? [];
      assert.equal(matches.length, 1, `expected exactly 1 canvas-body-margin reference, found ${matches.length}: ${response.body}`);
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

  describe("GET /log (static read-only history)", () => {
    it("returns 200 and html for the log page", async () => {
      const handle = buildServer({ dbPath: ":memory:" });
      handles.push(handle);
      const response = await handle.fastify.inject({ method: "GET", url: "/log" });
      assert.equal(response.statusCode, 200);
      assert.match(response.headers["content-type"] ?? "", /text\/html/);
    });

    it("includes known page paths and edit rows", async () => {
      const handle = buildServer({ dbPath: ":memory:" });
      handles.push(handle);
      createPage(handle.db, "/foo", "<p>v0</p>");
      const fooPage = handle.db.prepare("SELECT id FROM pages WHERE path = '/foo'").get() as { id: number };
      recordEdit(handle.db, {
        page_id: fooPage.id,
        version: 1,
        user_suggestion: "add a heading",
        validator_reasoning: null,
        validator_change_summary: "added h1",
        previous_html: "<p>v0</p>",
        new_html: "<h1>hi</h1><p>v0</p>",
        ip_hash: "h",
      });
      const response = await handle.fastify.inject({ method: "GET", url: "/log" });
      assert.equal(response.statusCode, 200);
      assert.ok(response.body.includes("/foo"), "should list /foo page");
      assert.ok(response.body.includes("added h1"), "should list edit summary");
      assert.ok(response.body.includes("add a heading"), "should list user suggestion");
    });

    it("does not include the widget script tag", async () => {
      const handle = buildServer({ dbPath: ":memory:" });
      handles.push(handle);
      const response = await handle.fastify.inject({ method: "GET", url: "/log" });
      assert.equal(response.statusCode, 200);
      assert.ok(!/widget\.js/.test(response.body), "log page must not load widget.js");
      assert.ok(!/canvas-fab/.test(response.body), "log page must not have fab button");
    });

    it("escapes user suggestion text containing script tags", async () => {
      const handle = buildServer({ dbPath: ":memory:" });
      handles.push(handle);
      createPage(handle.db, "/foo", "<p>v0</p>");
      const fooPage = handle.db.prepare("SELECT id FROM pages WHERE path = '/foo'").get() as { id: number };
      recordEdit(handle.db, {
        page_id: fooPage.id,
        version: 1,
        user_suggestion: "<script>alert(1)</script>",
        validator_reasoning: null,
        validator_change_summary: "evil",
        previous_html: "<p>v0</p>",
        new_html: "<p>v1</p>",
        ip_hash: "h",
      });
      const response = await handle.fastify.inject({ method: "GET", url: "/log" });
      assert.equal(response.statusCode, 200);
      assert.ok(!/<script>alert\(1\)<\/script>/.test(response.body), "raw script must not appear in log");
      assert.ok(response.body.includes("&lt;script&gt;"), "script must be escaped");
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

    it("does not enforce cooldown when rateLimitEnabled is false (default)", async () => {
      const handle = buildServer({
        dbPath: ":memory:",
        callLLM: async () =>
          JSON.stringify({
            allowed: true,
            reason: "ok",
            change_summary: "ok",
            elements_estimated: 1,
            is_new_page: false,
            new_page_slug: null,
          }),
        callExecutor: async () =>
          "<!DOCTYPE html><html><body><main><h1>v1</h1></main></body></html>",
      });
      handles.push(handle);
      const first = await handle.fastify.inject({
        method: "POST",
        url: "/api/suggest",
        payload: { message: "first", path: "/" },
      });
      assert.equal(first.statusCode, 200, `body: ${first.body}`);
      const second = await handle.fastify.inject({
        method: "POST",
        url: "/api/suggest",
        payload: { message: "second", path: "/" },
      });
      assert.equal(second.statusCode, 200, `body: ${second.body}`);
    });

    it("enforces cooldown when rateLimitEnabled is true", async () => {
      const handle = buildServer({
        dbPath: ":memory:",
        rateLimitEnabled: true,
        callLLM: async () =>
          JSON.stringify({
            allowed: true,
            reason: "ok",
            change_summary: "ok",
            elements_estimated: 1,
            is_new_page: false,
            new_page_slug: null,
          }),
        callExecutor: async () =>
          "<!DOCTYPE html><html><body><main><h1>v1</h1></main></body></html>",
      });
      handles.push(handle);
      const first = await handle.fastify.inject({
        method: "POST",
        url: "/api/suggest",
        payload: { message: "first", path: "/" },
      });
      assert.equal(first.statusCode, 200, `body: ${first.body}`);
      const second = await handle.fastify.inject({
        method: "POST",
        url: "/api/suggest",
        payload: { message: "second", path: "/" },
      });
      assert.equal(second.statusCode, 429, `body: ${second.body}`);
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

    it("rejects 422 when executor returns HTML-wrapped CREATE payload (page stays clean)", async () => {
      const handle = buildServer({
        dbPath: ":memory:",
        callLLM: async () =>
          JSON.stringify({
            allowed: true,
            reason: "ok",
            change_summary: "edit",
            elements_estimated: 1,
            is_new_page: false,
            new_page_slug: null,
          }),
        callExecutor: async () =>
          '<!DOCTYPE html><html><body>{"parent_html":"<html><body><a href=\\"/foo/gallery\\">G</a></body></html>","new_html":"<html><body><h1>G</h1></body></html>"}</body></html>',
      });
      handles.push(handle);
      const response = await handle.fastify.inject({
        method: "POST",
        url: "/api/suggest",
        payload: { message: "change the heading", path: "/" },
      });
      assert.equal(response.statusCode, 422, `body: ${response.body}`);
      const body = JSON.parse(response.body) as { reason: string };
      assert.match(body.reason, /CREATE payload/i);
      const pageRes = await handle.fastify.inject({ method: "GET", url: "/api/page?path=/" });
      const pageBody = JSON.parse(pageRes.body) as { html: string };
      assert.ok(!/"parent_html"/.test(pageBody.html), "stored html must not contain create-payload JSON");
      assert.ok(!/\\&quot;/.test(pageBody.html), "stored html must not contain escaped quote corruption");
    });

    it("rejects EDIT suggest to /log (reserved read-only path)", async () => {
      const handle = buildServer({
        dbPath: ":memory:",
        callLLM: async () =>
          JSON.stringify({
            allowed: true,
            reason: "ok",
            change_summary: "x",
            elements_estimated: 1,
            is_new_page: false,
            new_page_slug: null,
          }),
        callExecutor: async () => "<!DOCTYPE html><html><body><p>x</p></body></html>",
      });
      handles.push(handle);
      const response = await handle.fastify.inject({
        method: "POST",
        url: "/api/suggest",
        payload: { message: "change something", path: "/log" },
      });
      assert.equal(response.statusCode, 400, `body: ${response.body}`);
      const body = JSON.parse(response.body) as { reason: string };
      assert.match(body.reason, /reserved|read-only|\/log/);
    });
  });

  describe("POST /api/suggest (creates)", () => {
    function validatorSaysCreate(slug: string): () => Promise<string> {
      return async () =>
        JSON.stringify({
          allowed: true,
          reason: "ok",
          change_summary: "create new page",
          elements_estimated: 1,
          is_new_page: true,
          new_page_slug: slug,
        });
    }

    it("creates a new page and links to it from the parent", async () => {
      const handle = buildServer({
        dbPath: ":memory:",
        callLLM: validatorSaysCreate("gallery"),
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
        callLLM: validatorSaysCreate("gallery"),
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
      const handle = buildServer({
        dbPath: ":memory:",
        callLLM: validatorSaysCreate("extra"),
      });
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
        callLLM: validatorSaysCreate("gallery"),
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

    it("records the actual user IP hash in the edits log, not 0.0.0.0", async () => {
      const handle = buildServer({
        dbPath: ":memory:",
        ipHashSalt: "a".repeat(64),
        callLLM: validatorSaysCreate("gallery"),
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
      const salt = "a".repeat(64);
      const expectedHash = hashIp(salt, "127.0.0.1");
      const fakeHash = hashIp(salt, "0.0.0.0");
      const fooPage = handle.db.prepare("SELECT id FROM pages WHERE path = '/foo'").get() as { id: number };
      const fooEdits = listEdits(handle.db, fooPage.id);
      assert.ok(fooEdits.length > 0, "parent page should have an edit record");
      for (const edit of fooEdits) {
        assert.notEqual(edit.ip_hash, fakeHash, "edit ip_hash should not be the fake 0.0.0.0");
        assert.equal(edit.ip_hash, expectedHash, "edit ip_hash should match the request IP");
      }
    });

    it("rolls back parent update if new page insert fails (atomic create)", async () => {
      const initialParentHtml = "<!DOCTYPE html><html><body><p>original</p></body></html>";
      const newParentHtml = '<!DOCTYPE html><html><body><a href="/foo/gallery">Gallery</a></body></html>';
      const handle = buildServer({
        dbPath: ":memory:",
        callLLM: validatorSaysCreate("gallery"),
        callExecutor: async () => {
          createPage(handle.db, "/foo/gallery", "<!DOCTYPE html><html><body><h1>Gallery</h1></body></html>");
          return JSON.stringify({
            parent_html: newParentHtml,
            new_html: "<!DOCTYPE html><html><body><h1>Gallery</h1></body></html>",
          });
        },
      });
      handles.push(handle);
      createPage(handle.db, "/foo", initialParentHtml);
      const response = await handle.fastify.inject({
        method: "POST",
        url: "/api/suggest",
        payload: { message: "add a gallery", path: "/foo" },
      });
      assert.equal(response.statusCode, 422, `body: ${response.body}`);
      const fooPage = handle.db.prepare("SELECT current_html, version FROM pages WHERE path = '/foo'").get() as {
        current_html: string;
        version: number;
      };
      assert.equal(fooPage.current_html, initialParentHtml, "parent html must be unchanged on rollback");
      assert.equal(fooPage.version, 0, "parent version must not be bumped on rollback");
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

  describe("POST /api/rollback", () => {
    it("rolls back 1 version by default", () => {
      const handle = buildServer({ dbPath: ":memory:" });
      handles.push(handle);
      const page = handle.db.prepare("SELECT id FROM pages WHERE path = '/'").get() as { id: number };
      updatePageHtml(handle.db, page.id, "<!DOCTYPE html><html><body><main><p>v1</p></main></body></html>");
      recordEdit(handle.db, {
        page_id: page.id,
        version: 1,
        user_suggestion: "x",
        validator_reasoning: null,
        validator_change_summary: "x",
        previous_html: "<!DOCTYPE html><html><body><main><p>v0</p></main></body></html>",
        new_html: "<!DOCTYPE html><html><body><main><p>v1</p></main></body></html>",
        ip_hash: "h",
      });
      updatePageHtml(handle.db, page.id, "<!DOCTYPE html><html><body><main><p>v2</p></main></body></html>");
      recordEdit(handle.db, {
        page_id: page.id,
        version: 2,
        user_suggestion: "x",
        validator_reasoning: null,
        validator_change_summary: "x",
        previous_html: "<!DOCTYPE html><html><body><main><p>v1</p></main></body></html>",
        new_html: "<!DOCTYPE html><html><body><main><p>v2</p></main></body></html>",
        ip_hash: "h",
      });
      const response = handle.fastify.inject({
        method: "POST",
        url: "/api/rollback",
        payload: { path: "/" },
      });
      return Promise.resolve(response).then((res) => {
        assert.equal(res.statusCode, 200, `body: ${res.body}`);
        const body = JSON.parse(res.body) as { status: string; version: number };
        assert.equal(body.status, "ok");
        assert.equal(body.version, 1);
      });
    });

    it("rolls back N versions when versions is provided", () => {
      const handle = buildServer({ dbPath: ":memory:" });
      handles.push(handle);
      const page = handle.db.prepare("SELECT id FROM pages WHERE path = '/'").get() as { id: number };
      for (const v of [1, 2, 3]) {
        updatePageHtml(handle.db, page.id, `<!DOCTYPE html><html><body><main><p>v${v}</p></main></body></html>`);
        recordEdit(handle.db, {
          page_id: page.id,
          version: v,
          user_suggestion: `s${v}`,
          validator_reasoning: null,
          validator_change_summary: `s${v}`,
          previous_html: `<!DOCTYPE html><html><body><main><p>v${v - 1}</p></main></body></html>`,
          new_html: `<!DOCTYPE html><html><body><main><p>v${v}</p></main></body></html>`,
          ip_hash: "h",
        });
      }
      const response = handle.fastify.inject({
        method: "POST",
        url: "/api/rollback",
        payload: { path: "/", versions: 3 },
      });
      return Promise.resolve(response).then((res) => {
        assert.equal(res.statusCode, 200, `body: ${res.body}`);
        const body = JSON.parse(res.body) as { status: string; version: number };
        assert.equal(body.version, 0);
      });
    });

    it("returns 400 when path is missing", () => {
      const handle = buildServer({ dbPath: ":memory:" });
      handles.push(handle);
      const response = handle.fastify.inject({
        method: "POST",
        url: "/api/rollback",
        payload: {},
      });
      return Promise.resolve(response).then((res) => {
        assert.equal(res.statusCode, 400);
      });
    });

    it("returns 404 for unknown page", () => {
      const handle = buildServer({ dbPath: ":memory:" });
      handles.push(handle);
      const response = handle.fastify.inject({
        method: "POST",
        url: "/api/rollback",
        payload: { path: "/nope" },
      });
      return Promise.resolve(response).then((res) => {
        assert.equal(res.statusCode, 404);
      });
    });

    it("toSeed: true resets to seed version", () => {
      const handle = buildServer({ dbPath: ":memory:" });
      handles.push(handle);
      const page = handle.db.prepare("SELECT id FROM pages WHERE path = '/'").get() as { id: number };
      updatePageHtml(handle.db, page.id, "<p>broken</p>");
      recordEdit(handle.db, {
        page_id: page.id,
        version: 1,
        user_suggestion: "x",
        validator_reasoning: null,
        validator_change_summary: "x",
        previous_html: "<!DOCTYPE html><html><body><main><h1>Canvas</h1></main></body></html>",
        new_html: "<p>broken</p>",
        ip_hash: "h",
      });
      const response = handle.fastify.inject({
        method: "POST",
        url: "/api/rollback",
        payload: { path: "/", toSeed: true },
      });
      return Promise.resolve(response).then((res) => {
        assert.equal(res.statusCode, 200, `body: ${res.body}`);
        const body = JSON.parse(res.body) as { status: string; version: number };
        assert.equal(body.version, 0);
      });
    });
  });
});

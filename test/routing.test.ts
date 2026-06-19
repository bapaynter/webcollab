import { describe, it, after } from "node:test";
import { strict as assert } from "node:assert";
import { buildServer, type ServerHandle } from "../src/server.js";
import { createPage } from "../src/pages.js";
import type { CallOptions } from "../src/llm.js";

describe("suggest routing (LLM-based)", () => {
  const handles: ServerHandle[] = [];

  after(async () => {
    for (const h of handles) {
      await h.close();
    }
  });

  function validatorOk(overrides: Record<string, unknown> = {}): (opts: CallOptions) => Promise<string> {
    return async () =>
      JSON.stringify({
        allowed: true,
        reason: "ok",
        change_summary: "ok",
        elements_estimated: 1,
        is_new_page: false,
        new_page_slug: null,
        ...overrides,
      });
  }

  it("routes to edit pipeline when validator says is_new_page=false, even with 'create' words in message", async () => {
    const executorCalls: CallOptions[] = [];
    const handle = buildServer({
      dbPath: ":memory:",
      callLLM: validatorOk({ is_new_page: false, new_page_slug: null }),
      callExecutor: async (opts) => {
        executorCalls.push(opts);
        return "<!DOCTYPE html><html><body><main><p>edited</p></main></body></html>";
      },
    });
    handles.push(handle);
    createPage(handle.db, "/foo", "<!DOCTYPE html><html><body><main><p>orig</p></main></body></html>");
    const response = await handle.fastify.inject({
      method: "POST",
      url: "/api/suggest",
      payload: { message: "create a more welcoming vibe on this page", path: "/foo" },
    });
    assert.equal(response.statusCode, 200, `body: ${response.body}`);
    assert.equal(executorCalls.length, 1, "executor should be called exactly once (edit, not create)");
    const userPrompt = executorCalls[0]?.messages[1]?.content ?? "";
    assert.ok(!userPrompt.includes("parent_html"), "executor should receive EDIT prompt, not CREATE prompt");
  });

  it("routes to create pipeline when validator says is_new_page=true with slug", async () => {
    const executorCalls: CallOptions[] = [];
    const handle = buildServer({
      dbPath: ":memory:",
      callLLM: validatorOk({ is_new_page: true, new_page_slug: "gallery" }),
      callExecutor: async (opts) => {
        executorCalls.push(opts);
        return JSON.stringify({
          parent_html: '<!DOCTYPE html><html><body><a href="/foo/gallery">Gallery</a></body></html>',
          new_html: "<!DOCTYPE html><html><body><h1>Gallery</h1></body></html>",
        });
      },
    });
    handles.push(handle);
    createPage(handle.db, "/foo", "<!DOCTYPE html><html><body></body></html>");
    const response = await handle.fastify.inject({
      method: "POST",
      url: "/api/suggest",
      payload: { message: "make this place cooler", path: "/foo" },
    });
    assert.equal(response.statusCode, 200, `body: ${response.body}`);
    assert.equal(executorCalls.length, 1, "executor should be called exactly once (create)");
    const newPageResponse = await handle.fastify.inject({ method: "GET", url: "/foo/gallery" });
    assert.equal(newPageResponse.statusCode, 200, `new page should exist: ${newPageResponse.body}`);
  });

  it("uses LLM-provided slug as the new page path", async () => {
    const handle = buildServer({
      dbPath: ":memory:",
      callLLM: validatorOk({ is_new_page: true, new_page_slug: "blog" }),
      callExecutor: async () =>
        JSON.stringify({
          parent_html: '<!DOCTYPE html><html><body><a href="/blog">Blog</a></body></html>',
          new_html: "<!DOCTYPE html><html><body><h1>Blog</h1></body></html>",
        }),
    });
    handles.push(handle);
    const response = await handle.fastify.inject({
      method: "POST",
      url: "/api/suggest",
      payload: { message: "create a blog", path: "/" },
    });
    assert.equal(response.statusCode, 200, `body: ${response.body}`);
    const newPage = await handle.fastify.inject({ method: "GET", url: "/blog" });
    assert.equal(newPage.statusCode, 200);
  });

  it("falls back to slugInfer when validator returns is_new_page=true with no slug", async () => {
    const handle = buildServer({
      dbPath: ":memory:",
      callLLM: validatorOk({ is_new_page: true, new_page_slug: null }),
      callExecutor: async () =>
        JSON.stringify({
          parent_html: '<!DOCTYPE html><html><body><a href="/gallery">Gallery</a></body></html>',
          new_html: "<!DOCTYPE html><html><body><h1>Gallery</h1></body></html>",
        }),
    });
    handles.push(handle);
    const response = await handle.fastify.inject({
      method: "POST",
      url: "/api/suggest",
      payload: { message: "add a gallery", path: "/" },
    });
    assert.equal(response.statusCode, 200, `body: ${response.body}`);
    const newPage = await handle.fastify.inject({ method: "GET", url: "/gallery" });
    assert.equal(newPage.statusCode, 200);
  });

  it("rejects when validator says is_new_page=true but no slug can be inferred", async () => {
    const handle = buildServer({
      dbPath: ":memory:",
      callLLM: validatorOk({ is_new_page: true, new_page_slug: null }),
      callExecutor: async () => {
        throw new Error("executor should not be called");
      },
    });
    handles.push(handle);
    const response = await handle.fastify.inject({
      method: "POST",
      url: "/api/suggest",
      payload: { message: "go", path: "/" },
    });
    assert.equal(response.statusCode, 422, `body: ${response.body}`);
    const body = JSON.parse(response.body) as { reason: string };
    assert.match(body.reason, /slug/i);
  });

  it("rejects when validator says is_new_page=true and slug exceeds depth", async () => {
    const handle = buildServer({
      dbPath: ":memory:",
      callLLM: validatorOk({ is_new_page: true, new_page_slug: "extra" }),
      callExecutor: async () => {
        throw new Error("executor should not be called");
      },
    });
    handles.push(handle);
    createPage(handle.db, "/a/b/c/d", "<!DOCTYPE html><html><body></body></html>");
    const response = await handle.fastify.inject({
      method: "POST",
      url: "/api/suggest",
      payload: { message: "create extra", path: "/a/b/c/d" },
    });
    assert.equal(response.statusCode, 422, `body: ${response.body}`);
    const body = JSON.parse(response.body) as { reason: string };
    assert.match(body.reason, /depth/i);
  });

  it("uses configured maxPageDepth for create routing", async () => {
    const handle = buildServer({
      dbPath: ":memory:",
      maxPageDepth: 2,
      callLLM: validatorOk({ is_new_page: true, new_page_slug: "extra" }),
      callExecutor: async () => {
        throw new Error("executor should not be called");
      },
    });
    handles.push(handle);
    createPage(handle.db, "/a/b", "<!DOCTYPE html><html><body></body></html>");
    const response = await handle.fastify.inject({
      method: "POST",
      url: "/api/suggest",
      payload: { message: "create extra", path: "/a/b" },
    });
    assert.equal(response.statusCode, 422, `body: ${response.body}`);
    const body = JSON.parse(response.body) as { reason: string };
    assert.match(body.reason, /depth/i);
  });

  it("rejects when validator returns allowed=false before any pipeline runs", async () => {
    const executorCalled = { value: false };
    const handle = buildServer({
      dbPath: ":memory:",
      callLLM: async () =>
        JSON.stringify({
          allowed: false,
          reason: "policy violation",
          change_summary: "",
          elements_estimated: 0,
          is_new_page: false,
          new_page_slug: null,
        }),
      callExecutor: async () => {
        executorCalled.value = true;
        return "<html></html>";
      },
    });
    handles.push(handle);
    const response = await handle.fastify.inject({
      method: "POST",
      url: "/api/suggest",
      payload: { message: "do bad stuff", path: "/" },
    });
    assert.equal(response.statusCode, 422, `body: ${response.body}`);
    assert.equal(executorCalled.value, false, "executor must not be called when validator rejects");
  });

  it("does not require 'create'/'make'/'add' words in message to route to edit", async () => {
    const executorCalls: CallOptions[] = [];
    const handle = buildServer({
      dbPath: ":memory:",
      callLLM: validatorOk(),
      callExecutor: async (opts) => {
        executorCalls.push(opts);
        return "<!DOCTYPE html><html><body><main><p>ok</p></main></body></html>";
      },
    });
    handles.push(handle);
    createPage(handle.db, "/foo", "<!DOCTYPE html><html><body><main><p>orig</p></main></body></html>");
    const response = await handle.fastify.inject({
      method: "POST",
      url: "/api/suggest",
      payload: { message: "make the heading bigger", path: "/foo" },
    });
    assert.equal(response.statusCode, 200, `body: ${response.body}`);
    assert.equal(executorCalls.length, 1);
  });
});

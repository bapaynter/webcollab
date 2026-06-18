import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { callChat, callJson } from "../src/llm.js";

describe("llm", () => {
  let originalFetch: typeof fetch;
  let lastRequest: { url: string; init: RequestInit } | null = null;
  let responseFactory: () => Response = () => new Response("{}", { status: 200 });

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    lastRequest = null;
    responseFactory = () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
      lastRequest = { url: url.toString(), init: init ?? {} };
      return Promise.resolve(responseFactory());
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("callChat", () => {
    it("POSTs to OpenRouter and returns content from a chat-completion response", async () => {
      responseFactory = () =>
        new Response(JSON.stringify({ choices: [{ message: { content: "hello" } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      const out = await callChat({ apiKey: "k", model: "m", messages: [{ role: "user", content: "hi" }] });
      assert.equal(out, "hello");
      assert.ok(lastRequest);
      assert.match(lastRequest!.url, /openrouter\.ai\/api\/v1\/chat\/completions/);
      assert.equal(lastRequest!.init.method, "POST");
    });

    it("includes auth header", async () => {
      await callChat({ apiKey: "test-key", model: "m", messages: [] });
      const headers = new Headers(lastRequest!.init.headers);
      assert.equal(headers.get("Authorization"), "Bearer test-key");
    });

    it("throws on non-2xx", async () => {
      responseFactory = () => new Response("bad", { status: 500 });
      await assert.rejects(() => callChat({ apiKey: "k", model: "m", messages: [] }), /500/);
    });

    it("throws on empty content", async () => {
      responseFactory = () =>
        new Response(JSON.stringify({ choices: [{ message: { content: "" } }] }), { status: 200 });
      await assert.rejects(() => callChat({ apiKey: "k", model: "m", messages: [] }), /empty/);
    });
  });

  describe("callJson", () => {
    it("returns parsed JSON from content", async () => {
      responseFactory = () =>
        new Response(JSON.stringify({ choices: [{ message: { content: '{"foo":1}' } }] }), { status: 200 });
      const out = await callJson({ apiKey: "k", model: "m", messages: [] });
      assert.deepEqual(out, { foo: 1 });
    });

    it("throws on non-JSON content", async () => {
      responseFactory = () =>
        new Response(JSON.stringify({ choices: [{ message: { content: "not json" } }] }), { status: 200 });
      await assert.rejects(() => callJson({ apiKey: "k", model: "m", messages: [] }), /json/i);
    });
  });
});

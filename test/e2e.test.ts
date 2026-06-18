import { describe, it, after } from "node:test";
import { strict as assert } from "node:assert";
import { WebSocket } from "ws";
import { buildServer, type ServerHandle } from "../src/server.js";
import { callChat, type CallOptions } from "../src/llm.js";

function stubLLM(responses: ReadonlyMap<string, string>): (options: CallOptions) => Promise<string> {
  return async (options: CallOptions) => {
    const last = options.messages[options.messages.length - 1];
    if (last === undefined) throw new Error("no messages");
    const key = last.content.slice(0, 80);
    const response = responses.get(key) ?? responses.get("__default__");
    if (response === undefined) {
      throw new Error(`no stub for: ${key.slice(0, 60)}`);
    }
    void callChat;
    return response;
  };
}

describe("end-to-end", () => {
  const handles: ServerHandle[] = [];

  after(async () => {
    for (const h of handles) {
      await h.close();
    }
  });

  it("happy path: suggest accepted, page version bumps, ws client receives edit event", async () => {
    const executorResponse =
      "<!DOCTYPE html><html><body><main><h1>Welcome</h1><p>Suggest a change in the chat.</p></main></body></html>";
    const validatorResponse = JSON.stringify({
      allowed: true,
      reason: "ok",
      change_summary: "added h1",
      elements_estimated: 1,
      is_new_page: false,
      new_page_slug: null,
    });
    const handle = buildServer({
      dbPath: ":memory:",
      callLLM: async () => validatorResponse,
      callExecutor: async () => executorResponse,
    });
    handles.push(handle);
    await handle.fastify.listen({ port: 0, host: "127.0.0.1" });
    const address = handle.fastify.server.address();
    if (typeof address !== "object" || address === null) throw new Error("no address");
    const port = address.port;
    const url = `ws://127.0.0.1:${port}/ws`;

    const received: string[] = [];
    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    ws.on("message", (data) => received.push(data.toString()));

    const suggestRes = await fetch(`http://127.0.0.1:${port}/api/suggest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "add a heading to say Welcome", path: "/" }),
    });
    const suggestBody = (await suggestRes.json()) as { status: string; version: number };
    assert.equal(suggestBody.status, "accepted");
    assert.equal(suggestBody.version, 1);

    await new Promise((r) => setTimeout(r, 50));
    assert.ok(received.length >= 1, "expected ws event");
    const event = JSON.parse(received[0] ?? "{}") as { type: string; path: string; version: number };
    assert.equal(event.type, "edit");
    assert.equal(event.path, "/");
    assert.equal(event.version, 1);

    const pageRes = await fetch(`http://127.0.0.1:${port}/api/page?path=/`);
    const pageBody = (await pageRes.json()) as { html: string; version: number };
    assert.match(pageBody.html, /Welcome/);
    assert.equal(pageBody.version, 1);

    ws.close();
  });

  void stubLLM;

  it("new-page flow: creates new page, links from parent, emits two ws events", async () => {
    const executorResponse = JSON.stringify({
      parent_html:
        '<!DOCTYPE html><html><body><main><h1>x</h1><p>Suggest a change in the chat.</p><a href="/gallery">Gallery</a></main></body></html>',
      new_html: "<!DOCTYPE html><html><body><main><h1>Gallery</h1></main></body></html>",
    });
    const handle = buildServer({
      dbPath: ":memory:",
      callExecutor: async () => executorResponse,
    });
    handles.push(handle);
    await handle.fastify.listen({ port: 0, host: "127.0.0.1" });
    const address = handle.fastify.server.address();
    if (typeof address !== "object" || address === null) throw new Error("no address");
    const port = address.port;

    const received: Array<{ type: string; path: string; version: number }> = [];
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    ws.on("message", (data) => {
      const parsed = JSON.parse(data.toString()) as { type: string; path: string; version: number };
      received.push(parsed);
    });

    const suggestRes = await fetch(`http://127.0.0.1:${port}/api/suggest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "add a gallery", path: "/" }),
    });
    const suggestBody = (await suggestRes.json()) as { status: string; path: string; version: number; reason: string };
    assert.equal(suggestBody.status, "accepted", `body: ${JSON.stringify(suggestBody)}`);
    assert.equal(suggestBody.path, "/");

    await new Promise((r) => setTimeout(r, 50));
    const paths = received.map((e) => e.path).sort();
    assert.deepEqual(paths, ["/", "/gallery"]);

    const newPageRes = await fetch(`http://127.0.0.1:${port}/api/page?path=/gallery`);
    const newPageBody = (await newPageRes.json()) as { html: string };
    assert.match(newPageBody.html, /Gallery/);

    ws.close();
  });
});

import { describe, it, after } from "node:test";
import { strict as assert } from "node:assert";
import { buildServer, type ServerHandle } from "../src/server.js";

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
});

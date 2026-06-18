import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { applyEdit, applyCreate, type ExecutorDeps } from "../src/executor.js";

function makeDeps(overrides: Partial<ExecutorDeps> = {}): ExecutorDeps {
  return {
    apiKey: "k",
    model: "m",
    maxTokens: 8192,
    callLLM: async () => {
      throw new Error("callLLM not configured");
    },
    ...overrides,
  };
}

describe("executor", () => {
  describe("applyEdit", () => {
    it("returns full updated HTML", async () => {
      const deps = makeDeps({
        callLLM: async () => "<!DOCTYPE html><html><body><h1>Hi</h1></body></html>",
      });
      const result = await applyEdit(deps, "add a heading", "<!DOCTYPE html><html><body></body></html>", "/foo");
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.match(result.html, /<h1>Hi<\/h1>/);
      }
    });

    it("strips code fences from response", async () => {
      const deps = makeDeps({
        callLLM: async () => "```html\n<!DOCTYPE html><html><body><h1>Hi</h1></body></html>\n```",
      });
      const result = await applyEdit(deps, "add a heading", "<html></html>", "/foo");
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.ok(!result.html.includes("```"));
        assert.match(result.html, /<h1>Hi<\/h1>/);
      }
    });

    it("returns ok=false on LLM error", async () => {
      const deps = makeDeps({
        callLLM: async () => {
          throw new Error("upstream 500");
        },
      });
      const result = await applyEdit(deps, "x", "<html></html>", "/foo");
      assert.equal(result.ok, false);
    });
  });

  describe("applyCreate", () => {
    it("returns both parent and new HTML", async () => {
      const deps = makeDeps({
        callLLM: async () =>
          JSON.stringify({
            parent_html: "<!DOCTYPE html><html><body><a href=\"/foo/gallery\">Gallery</a></body></html>",
            new_html: "<!DOCTYPE html><html><body><h1>Gallery</h1></body></html>",
          }),
      });
      const result = await applyCreate(deps, "add a gallery", "<html><body></body></html>", "/foo", "/foo/gallery");
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.match(result.parent_html, /href="\/foo\/gallery"/);
        assert.match(result.new_html, /<h1>Gallery<\/h1>/);
      }
    });

    it("returns ok=false on JSON parse error", async () => {
      const deps = makeDeps({
        callLLM: async () => "not json",
      });
      const result = await applyCreate(deps, "x", "<html></html>", "/foo", "/foo/gallery");
      assert.equal(result.ok, false);
    });
  });
});

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
    it("applies JSON patch operations", async () => {
      const deps = makeDeps({
        callLLM: async () =>
          JSON.stringify({
            operations: [
              {
                op: "replace",
                target: "<h1>Old</h1>",
                content: "<h1>New</h1>",
              },
            ],
          }),
      });
      const result = await applyEdit(
        deps,
        "change heading",
        "<!DOCTYPE html><html><body><main><h1>Old</h1></main></body></html>",
        "/foo",
      );
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.match(result.html, /<h1>New<\/h1>/);
        assert.match(result.previousHtml, /<h1>Old<\/h1>/);
      }
    });

    it("loads latest HTML before applying patch when callback provided", async () => {
      const deps = makeDeps({
        callLLM: async () =>
          JSON.stringify({
            operations: [
              {
                op: "replace",
                target: "<h1>Latest</h1>",
                content: "<h1>Patched</h1>",
              },
            ],
          }),
      });
      const result = await applyEdit(
        deps,
        "change heading",
        "<!DOCTYPE html><html><body><main><h1>Old</h1></main></body></html>",
        "/foo",
        async () => "<!DOCTYPE html><html><body><main><h1>Latest</h1></main></body></html>",
      );
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.match(result.html, /<h1>Patched<\/h1>/);
        assert.match(result.previousHtml, /<h1>Latest<\/h1>/);
      }
    });

    it("returns patch conflict when patch does not fit latest HTML", async () => {
      const deps = makeDeps({
        callLLM: async () =>
          JSON.stringify({
            operations: [
              {
                op: "replace",
                target: "<h1>Old</h1>",
                content: "<h1>Patched</h1>",
              },
            ],
          }),
      });
      const result = await applyEdit(
        deps,
        "change heading",
        "<!DOCTYPE html><html><body><main><h1>Old</h1></main></body></html>",
        "/foo",
        async () => "<!DOCTYPE html><html><body><main><h1>Latest</h1></main></body></html>",
      );
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.match(result.reason, /patch conflict/i);
      }
    });

    it("returns full updated HTML", async () => {
      const deps = makeDeps({
        callLLM: async () => "<!DOCTYPE html><html><body><h1>Hi</h1></body></html>",
      });
      const result = await applyEdit(deps, "add a heading", "<!DOCTYPE html><html><body></body></html>", "/foo");
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.match(result.html, /<h1>Hi<\/h1>/);
        assert.match(result.previousHtml, /<body><\/body>/);
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

    it("returns ok=false on malformed non-HTML response", async () => {
      const deps = makeDeps({
        callLLM: async () => "not-json-not-html",
      });
      const result = await applyEdit(deps, "x", "<html><body></body></html>", "/foo");
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.match(result.reason, /malformed/i);
      }
    });

    it("rejects raw CREATE JSON returned for an EDIT request", async () => {
      const deps = makeDeps({
        callLLM: async () =>
          JSON.stringify({
            parent_html: '<!DOCTYPE html><html><body><a href="/foo/gallery">Gallery</a></body></html>',
            new_html: "<!DOCTYPE html><html><body><h1>Gallery</h1></body></html>",
          }),
      });
      const result = await applyEdit(deps, "add a gallery", "<html><body></body></html>", "/foo");
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.match(result.reason, /CREATE payload/i);
      }
    });

    it("rejects HTML-wrapped CREATE JSON returned for an EDIT request", async () => {
      const wrapped =
        '<!DOCTYPE html><html><body>{"parent_html":"<html><body><a href=\\"/foo/gallery\\">Gallery</a></body></html>","new_html":"<html><body><h1>Gallery</h1></body></html>"}</body></html>';
      const deps = makeDeps({
        callLLM: async () => wrapped,
      });
      const result = await applyEdit(deps, "add a gallery", "<html><body></body></html>", "/foo");
      assert.equal(result.ok, false, `expected rejection, got: ${JSON.stringify(result)}`);
      if (!result.ok) {
        assert.match(result.reason, /CREATE payload/i);
      }
    });

    it("rejects entity-escaped HTML-wrapped CREATE JSON for an EDIT request", async () => {
      const wrapped =
        '<!DOCTYPE html><html><body>{&quot;parent_html&quot;:&quot;&lt;html&gt;&lt;body&gt;&lt;a href=\\&quot;/foo/gallery\\&quot;&gt;Gallery&lt;/a&gt;&lt;/body&gt;&lt;/html&gt;&quot;,&quot;new_html&quot;:&quot;&lt;html&gt;&lt;body&gt;&lt;h1&gt;Gallery&lt;/h1&gt;&lt;/body&gt;&lt;/html&gt;&quot;}</body></html>';
      const deps = makeDeps({
        callLLM: async () => wrapped,
      });
      const result = await applyEdit(deps, "x", "<html><body></body></html>", "/foo");
      assert.equal(result.ok, false, `expected rejection, got: ${JSON.stringify(result)}`);
      if (!result.ok) {
        assert.match(result.reason, /CREATE payload/i);
      }
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

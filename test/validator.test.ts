import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { validate, type ValidatorDeps } from "../src/validator.js";

function makeDeps(overrides: Partial<ValidatorDeps> = {}): ValidatorDeps {
  return {
    apiKey: "test-key",
    model: "test-model",
    maxEditDelta: 20,
    callLLM: async () => {
      throw new Error("callLLM not configured");
    },
    ...overrides,
  };
}

describe("validator", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("happy path", () => {
    it("returns allowed=true for benign suggestion", async () => {
      const deps = makeDeps({
        callLLM: async () =>
          JSON.stringify({
            allowed: true,
            reason: "small visual change",
            change_summary: "added a heading",
            elements_estimated: 1,
            is_new_page: false,
            new_page_slug: null,
          }),
      });
      const result = await validate(deps, "add a heading that says Welcome", "<p>hi</p>", "/foo");
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.allowed, true);
        assert.equal(result.change_summary, "added a heading");
      }
    });
  });

  describe("rejections", () => {
    it("returns allowed=false when LLM says no", async () => {
      const deps = makeDeps({
        callLLM: async () =>
          JSON.stringify({
            allowed: false,
            reason: "destructive",
            change_summary: "",
            elements_estimated: 999,
            is_new_page: false,
            new_page_slug: null,
          }),
      });
      const result = await validate(deps, "remove everything", "<p>hi</p>", "/foo");
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.allowed, false);
        assert.equal(result.reason, "destructive");
      }
    });

    it("rejects when elements_estimated > maxEditDelta", async () => {
      const deps = makeDeps({
        maxEditDelta: 5,
        callLLM: async () =>
          JSON.stringify({
            allowed: true,
            reason: "ok",
            change_summary: "big change",
            elements_estimated: 50,
            is_new_page: false,
            new_page_slug: null,
          }),
      });
      const result = await validate(deps, "add 50 things", "<p>hi</p>", "/foo");
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.allowed, false);
        assert.match(result.reason, /exceeds|delta|max/i);
      }
    });

    it("uses configured maxEditDelta in validator system prompt", async () => {
      const recordedSystemPrompts: string[] = [];
      const deps = makeDeps({
        maxEditDelta: 100,
        callLLM: async (options) => {
          const systemPrompt = options.messages.find((message) => message.role === "system")?.content ?? "";
          recordedSystemPrompts.push(systemPrompt);
          return JSON.stringify({
            allowed: true,
            reason: "ok",
            change_summary: "add table rows",
            elements_estimated: 24,
            is_new_page: false,
            new_page_slug: null,
          });
        },
      });
      const result = await validate(deps, "add 4 table rows", "<table><tbody></tbody></table>", "/invoices");
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.allowed, true);
      }
      assert.equal(recordedSystemPrompts.length, 1);
      assert.match(recordedSystemPrompts[0] ?? "", /configured max \(100\)/i);
      assert.ok(!(recordedSystemPrompts[0] ?? "").includes("Exceed 20 element count delta"));
    });
  });

  describe("malformed responses", () => {
    it("treats non-JSON response as rejection", async () => {
      const deps = makeDeps({
        callLLM: async () => "not json at all",
      });
      const result = await validate(deps, "add a thing", "<p>hi</p>", "/foo");
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.allowed, false);
        assert.match(result.reason, /json|malformed/i);
      }
    });

    it("treats missing allowed field as rejection", async () => {
      const deps = makeDeps({
        callLLM: async () => JSON.stringify({ reason: "no allowed field" }),
      });
      const result = await validate(deps, "x", "<p>hi</p>", "/foo");
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.allowed, false);
      }
    });
  });

  describe("network errors", () => {
    it("returns ok=false on LLM error", async () => {
      const deps = makeDeps({
        callLLM: async () => {
          throw new Error("upstream 500");
        },
      });
      const result = await validate(deps, "x", "<p>hi</p>", "/foo");
      assert.equal(result.ok, false);
    });
  });
});

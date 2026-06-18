import { describe, it, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import { loadConfig } from "../src/config.js";

describe("config", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("throws when IP_HASH_SALT is missing", () => {
    delete process.env["IP_HASH_SALT"];
    process.env["OPENROUTER_API_KEY"] = "test-key";
    assert.throws(() => loadConfig(), /IP_HASH_SALT/);
  });

  it("throws when OPENROUTER_API_KEY is missing", () => {
    process.env["IP_HASH_SALT"] = "a".repeat(64);
    delete process.env["OPENROUTER_API_KEY"];
    assert.throws(() => loadConfig(), /OPENROUTER_API_KEY/);
  });

  it("returns typed config with defaults applied", () => {
    process.env["IP_HASH_SALT"] = "a".repeat(64);
    process.env["OPENROUTER_API_KEY"] = "test-key";
    const config = loadConfig();
    assert.equal(config.ipHashSalt, "a".repeat(64));
    assert.equal(config.openRouterApiKey, "test-key");
    assert.equal(config.cooldownMinutes, 60);
    assert.equal(config.maxEditDelta, 20);
    assert.equal(config.maxPageDepth, 4);
    assert.equal(config.port, 3131);
    assert.equal(config.host, "127.0.0.1");
  });
});

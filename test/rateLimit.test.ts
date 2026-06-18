import { describe, it, beforeEach } from "node:test";
import { strict as assert } from "node:assert";
import { initDb } from "../src/db.js";
import { checkCooldown, recordAttempt, hashIp } from "../src/rateLimit.js";

describe("rateLimit", () => {
  let db: ReturnType<typeof initDb>;

  beforeEach(() => {
    db = initDb(":memory:");
  });

  describe("hashIp", () => {
    it("produces deterministic 32-char hash from salt+ip", () => {
      const h1 = hashIp("a".repeat(64), "1.2.3.4");
      const h2 = hashIp("a".repeat(64), "1.2.3.4");
      assert.equal(h1, h2);
      assert.equal(h1.length, 32);
    });

    it("differs for different IPs with same salt", () => {
      const h1 = hashIp("a".repeat(64), "1.2.3.4");
      const h2 = hashIp("a".repeat(64), "5.6.7.8");
      assert.notEqual(h1, h2);
    });

    it("differs for different salts with same IP", () => {
      const h1 = hashIp("a".repeat(64), "1.2.3.4");
      const h2 = hashIp("b".repeat(64), "1.2.3.4");
      assert.notEqual(h1, h2);
    });
  });

  describe("checkCooldown", () => {
    it("returns ok=true for first-time IP", () => {
      const result = checkCooldown(db, hashIp("a".repeat(64), "1.2.3.4"));
      assert.equal(result.ok, true);
    });

    it("returns ok=false with until timestamp when in cooldown", () => {
      const ipHash = hashIp("a".repeat(64), "1.2.3.4");
      recordAttempt(db, ipHash, 60);
      const result = checkCooldown(db, ipHash);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.ok(result.until);
        assert.match(result.until, /^\d{4}-\d{2}-\d{2}T/);
      }
    });
  });

  describe("recordAttempt", () => {
    it("creates rate_limits row on first call", () => {
      const ipHash = hashIp("a".repeat(64), "1.2.3.4");
      recordAttempt(db, ipHash, 60);
      const row = db.prepare("SELECT * FROM rate_limits WHERE ip_hash = ?").get(ipHash) as {
        total_attempts: number;
        cooldown_until: string | null;
      };
      assert.ok(row);
      assert.equal(row.total_attempts, 1);
      assert.ok(row.cooldown_until);
    });

    it("increments total_attempts on subsequent calls", () => {
      const ipHash = hashIp("a".repeat(64), "1.2.3.4");
      recordAttempt(db, ipHash, 60);
      recordAttempt(db, ipHash, 60);
      const row = db.prepare("SELECT total_attempts FROM rate_limits WHERE ip_hash = ?").get(ipHash) as {
        total_attempts: number;
      };
      assert.equal(row.total_attempts, 2);
    });
  });
});

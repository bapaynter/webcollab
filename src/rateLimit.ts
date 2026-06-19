import { createHash } from "node:crypto";
import type { Database } from "./db.js";

export type CooldownResult = { ok: true } | { ok: false; until: string };

export function hashIp(salt: string, ip: string): string {
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32);
}

export function checkCooldown(db: Database, ipHash: string): CooldownResult {
  const row = db
    .prepare("SELECT cooldown_until FROM rate_limits WHERE ip_hash = ?")
    .get(ipHash) as { cooldown_until: string | null } | undefined;
  if (row === undefined || row.cooldown_until === null) {
    return { ok: true };
  }
  const cooldownUntilMs = Date.parse(row.cooldown_until);
  if (Number.isNaN(cooldownUntilMs) || Date.now() >= cooldownUntilMs) {
    return { ok: true };
  }
  return { ok: false, until: row.cooldown_until };
}

export function recordAttempt(db: Database, ipHash: string, cooldownMinutes: number): void {
  const cooldownUntil = new Date(Date.now() + cooldownMinutes * 60 * 1000).toISOString();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO rate_limits (ip_hash, last_suggestion_at, cooldown_until, total_attempts, total_rejected, flagged)
     VALUES (?, ?, ?, 1, 0, 0)
     ON CONFLICT(ip_hash) DO UPDATE SET
       last_suggestion_at = excluded.last_suggestion_at,
       cooldown_until = excluded.cooldown_until,
       total_attempts = total_attempts + 1`,
      ).run(ipHash, now, cooldownUntil);
}

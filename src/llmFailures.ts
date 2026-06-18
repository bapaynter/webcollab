import type { Database } from "./db.js";

const MAX_DETAIL_LENGTH = 300;

export type LLMFailureStage = "validator" | "executor_edit" | "executor_create";

export interface LLMFailureInsert {
  readonly stage: LLMFailureStage;
  readonly model: string;
  readonly path: string;
  readonly user_suggestion: string;
  readonly reason: string;
  readonly detail: string | null;
}

export interface LLMFailureRecord extends LLMFailureInsert {
  readonly id: number;
  readonly created_at: string;
}

export function recordLLMFailure(db: Database, failure: LLMFailureInsert): number {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO llm_failures
        (stage, model, path, user_suggestion, reason, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      failure.stage,
      failure.model,
      failure.path,
      failure.user_suggestion,
      failure.reason,
      truncateDetail(failure.detail),
      now,
    );
  return Number(result.lastInsertRowid);
}

export function listAllLLMFailures(db: Database): ReadonlyArray<LLMFailureRecord> {
  return db
    .prepare(
      `SELECT id, stage, model, path, user_suggestion, reason, detail, created_at
         FROM llm_failures
         ORDER BY created_at DESC, id DESC`,
    )
    .all() as LLMFailureRecord[];
}

function truncateDetail(detail: string | null): string | null {
  if (detail === null) {
    return null;
  }
  if (detail.length <= MAX_DETAIL_LENGTH) {
    return detail;
  }
  return detail.slice(0, MAX_DETAIL_LENGTH);
}

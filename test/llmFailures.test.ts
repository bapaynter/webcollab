import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { initDb } from "../src/db.js";
import { listAllLLMFailures, recordLLMFailure } from "../src/llmFailures.js";

describe("llmFailures", () => {
  it("records and lists failures newest-first", () => {
    const db = initDb(":memory:");
    recordLLMFailure(db, {
      stage: "validator",
      model: "model-a",
      path: "/",
      user_suggestion: "first",
      reason: "validator unavailable",
      detail: "upstream 503",
    });
    recordLLMFailure(db, {
      stage: "executor_edit",
      model: "model-b",
      path: "/foo",
      user_suggestion: "second",
      reason: "executor returned malformed response",
      detail: null,
    });

    const failures = listAllLLMFailures(db);
    assert.equal(failures.length, 2);
    assert.equal(failures[0]?.user_suggestion, "second");
    assert.equal(failures[0]?.stage, "executor_edit");
    assert.equal(failures[1]?.user_suggestion, "first");

    db.close();
  });

  it("truncates detail to 300 chars", () => {
    const db = initDb(":memory:");
    const longDetail = "x".repeat(500);
    recordLLMFailure(db, {
      stage: "validator",
      model: "model-a",
      path: "/",
      user_suggestion: "first",
      reason: "validator unavailable",
      detail: longDetail,
    });

    const failures = listAllLLMFailures(db);
    assert.equal(failures.length, 1);
    assert.equal(failures[0]?.detail?.length, 300);

    db.close();
  });
});

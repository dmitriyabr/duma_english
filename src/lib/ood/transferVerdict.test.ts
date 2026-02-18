import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateTransferVerdict,
  type InDomainControlAttempt,
} from "./transferVerdict";

function controlAttempt(params: {
  attemptId: string;
  score: number;
  difficulty: number;
  completedAt: string;
}): InDomainControlAttempt {
  return {
    attemptId: params.attemptId,
    taskScore: params.score,
    estimatedDifficulty: params.difficulty,
    completedAt: new Date(params.completedAt),
  };
}

test("evaluateTransferVerdict marks transfer pass when OOD score clears threshold", () => {
  const result = evaluateTransferVerdict({
    oodTaskScore: 78,
    inDomainDifficulty: 52,
    controlAttempts: [],
    now: new Date("2026-02-18T00:00:00Z"),
  });

  assert.equal(result.verdict, "transfer_pass");
  assert.equal(result.oodOutcome, "pass");
  assert.equal(result.matchedControlPass, false);
});

test("evaluateTransferVerdict validates transfer fail only with matched in-domain pass", () => {
  const result = evaluateTransferVerdict({
    oodTaskScore: 48,
    inDomainDifficulty: 50,
    controlAttempts: [
      controlAttempt({
        attemptId: "att_match_pass",
        score: 74,
        difficulty: 52,
        completedAt: "2026-02-17T22:00:00Z",
      }),
      controlAttempt({
        attemptId: "att_far_pass",
        score: 80,
        difficulty: 70,
        completedAt: "2026-02-17T21:00:00Z",
      }),
    ],
    now: new Date("2026-02-18T00:00:00Z"),
  });

  assert.equal(result.verdict, "transfer_fail_validated");
  assert.equal(result.oodOutcome, "candidate_fail");
  assert.equal(result.matchedControlPass, true);
  assert.equal(result.bestMatchedControl?.attemptId, "att_match_pass");
});

test("evaluateTransferVerdict returns inconclusive when fail has no matched control pass", () => {
  const result = evaluateTransferVerdict({
    oodTaskScore: 42,
    inDomainDifficulty: 50,
    controlAttempts: [
      controlAttempt({
        attemptId: "att_match_fail",
        score: 60,
        difficulty: 49,
        completedAt: "2026-02-17T22:00:00Z",
      }),
      controlAttempt({
        attemptId: "att_outside_tolerance",
        score: 85,
        difficulty: 63,
        completedAt: "2026-02-17T21:00:00Z",
      }),
    ],
    now: new Date("2026-02-18T00:00:00Z"),
  });

  assert.equal(result.verdict, "inconclusive_control_missing");
  assert.equal(result.oodOutcome, "candidate_fail");
  assert.equal(result.matchedControlPass, false);
  assert.equal(result.bestMatchedControl, null);
});

test("evaluateTransferVerdict returns inconclusive when OOD task score is missing", () => {
  const result = evaluateTransferVerdict({
    oodTaskScore: null,
    inDomainDifficulty: 50,
    controlAttempts: [
      controlAttempt({
        attemptId: "att_match_pass",
        score: 74,
        difficulty: 51,
        completedAt: "2026-02-17T22:00:00Z",
      }),
    ],
    now: new Date("2026-02-18T00:00:00Z"),
  });

  assert.equal(result.verdict, "inconclusive_missing_ood_score");
  assert.equal(result.oodOutcome, "unknown");
  assert.equal(result.matchedControlPass, true);
});

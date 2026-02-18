import assert from "node:assert/strict";
import test from "node:test";
import {
  SELF_REPAIR_MAX_LOOPS_PER_SKILL_SESSION,
  SELF_REPAIR_MAX_SESSION_TIME_SHARE,
  evaluateSelfRepairBudgetFromStats,
} from "./budgetGuardrails";

test("self-repair budget allows immediate retry within caps", () => {
  const usage = evaluateSelfRepairBudgetFromStats({
    loopsUsedForSkillSession: 1,
    sessionTotalDurationSec: 900,
    immediateDurationSec: 120,
    estimatedImmediateDurationSec: 90,
  });

  assert.equal(usage.exhausted, false);
  assert.deepEqual(usage.reasons, []);
  assert.equal(usage.maxLoopsPerSkillSession, SELF_REPAIR_MAX_LOOPS_PER_SKILL_SESSION);
  assert.equal(usage.maxSessionTimeShare, SELF_REPAIR_MAX_SESSION_TIME_SHARE);
});

test("self-repair budget exhausts when per-skill loop cap is reached", () => {
  const usage = evaluateSelfRepairBudgetFromStats({
    loopsUsedForSkillSession: 2,
    sessionTotalDurationSec: 1200,
    immediateDurationSec: 120,
    estimatedImmediateDurationSec: 80,
  });

  assert.equal(usage.exhausted, true);
  assert.equal(usage.reasons.includes("per_skill_loop_cap"), true);
});

test("self-repair budget exhausts when projected time share exceeds cap", () => {
  const usage = evaluateSelfRepairBudgetFromStats({
    loopsUsedForSkillSession: 0,
    sessionTotalDurationSec: 200,
    immediateDurationSec: 40,
    estimatedImmediateDurationSec: 80,
  });

  assert.equal(usage.exhausted, true);
  assert.equal(usage.reasons.includes("session_time_share_cap"), true);
  assert.equal(usage.projectedImmediateShare > SELF_REPAIR_MAX_SESSION_TIME_SHARE, true);
});

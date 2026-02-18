import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  REWARD_FUNCTION_VERSION_V1,
  buildRewardTraceContract,
  evaluateCompositeReward,
} from "./function";

test("reward function v1 enforces composite equation with versioned output", () => {
  const reward = evaluateCompositeReward({
    signals: {
      masteryDeltaTotal: 4.5,
      transferVerdict: "transfer_pass",
      retentionOutcome: "none",
      taskScore: 78,
      transcriptConfidence: 0.82,
      recoveryTriggered: false,
    },
  });

  assert.equal(reward.rewardVersion, REWARD_FUNCTION_VERSION_V1);
  assert.equal(
    reward.totalReward,
    Number(
      (
        reward.masteryDelta +
        reward.transferReward +
        reward.retentionReward -
        reward.frictionPenalty
      ).toFixed(6)
    )
  );
  assert.ok(reward.totalReward > 0);
});

test("reward trace contract builder stays valid for same-session write path", () => {
  const trace = buildRewardTraceContract({
    studentId: "student_1",
    decisionLogId: "decision_1",
    taskInstanceId: "task_instance_1",
    attemptId: "attempt_1",
    signals: {
      masteryDeltaTotal: -1.2,
      transferVerdict: "inconclusive_control_missing",
      retentionOutcome: "none",
      taskScore: 48,
      transcriptConfidence: 0.51,
      recoveryTriggered: true,
    },
  });

  assert.equal(trace.rewardVersion, REWARD_FUNCTION_VERSION_V1);
  assert.equal(trace.rewardWindow, "same_session");
  assert.equal(
    trace.totalReward,
    Number(
      (
        trace.masteryDelta +
        trace.transferReward +
        trace.retentionReward -
        trace.frictionPenalty
      ).toFixed(6)
    )
  );
  assert.ok(trace.frictionPenalty > 0);
});

test("replay reproducibility is deterministic for fixed reward inputs", () => {
  const replaySignals = [
    {
      masteryDeltaTotal: 2.1,
      transferVerdict: "transfer_pass" as const,
      retentionOutcome: "none" as const,
      taskScore: 80,
      transcriptConfidence: 0.88,
      recoveryTriggered: false,
    },
    {
      masteryDeltaTotal: -0.9,
      transferVerdict: "transfer_fail_validated" as const,
      retentionOutcome: "none" as const,
      taskScore: 52,
      transcriptConfidence: 0.49,
      recoveryTriggered: true,
    },
    {
      masteryDeltaTotal: 1.4,
      transferVerdict: null,
      retentionOutcome: "none" as const,
      taskScore: 71,
      transcriptConfidence: 0.77,
      recoveryTriggered: false,
    },
  ];

  const firstRun = replaySignals.map((signals) =>
    evaluateCompositeReward({ signals })
  );
  const secondRun = replaySignals.map((signals) =>
    evaluateCompositeReward({ signals })
  );

  assert.deepEqual(firstRun, secondRun);
  const firstHash = createHash("sha256")
    .update(JSON.stringify(firstRun))
    .digest("hex");
  const secondHash = createHash("sha256")
    .update(JSON.stringify(secondRun))
    .digest("hex");
  assert.equal(firstHash, secondHash);
});

import assert from "node:assert/strict";
import test from "node:test";
import { ATTEMPT_STATUS } from "@/lib/attemptStatus";
import {
  computeFrustrationProxyMetric,
  computeMasteryGainPerHourMetric,
  computeOodPassRateMetric,
  computeRetentionPassRateMetric,
  computeVerifiedGrowthMetric,
  percentile,
  type KpiAttemptRow,
} from "./autopilotDashboard";

test("percentile returns expected p95", () => {
  const p95 = percentile([10, 20, 30, 40, 50], 95);
  assert.equal(p95, 50);
});

test("mastery gain and verified growth metrics use node outcomes", () => {
  const attempts: KpiAttemptRow[] = [
    {
      status: ATTEMPT_STATUS.COMPLETED,
      durationSec: 1800,
      recoveryTriggered: false,
      taskEvaluationJson: { taskScore: 72 },
      nodeOutcomesJson: [
        { deltaMastery: 1.2, activationImpact: "none" },
        { deltaMastery: 0.8, activationImpact: "verified" },
      ],
    },
    {
      status: ATTEMPT_STATUS.COMPLETED,
      durationSec: 1800,
      recoveryTriggered: false,
      taskEvaluationJson: { taskScore: 68 },
      nodeOutcomesJson: [{ deltaMastery: -0.5, activationImpact: "verified" }],
    },
  ];

  const masteryMetric = computeMasteryGainPerHourMetric({ attempts, windowDays: 30 });
  assert.equal(masteryMetric.value, 1.5);
  assert.equal(masteryMetric.sampleSize, 2);

  const verifiedMetric = computeVerifiedGrowthMetric({ attempts, windowDays: 30 });
  assert.equal(verifiedMetric.value, 100);
  assert.equal(verifiedMetric.numerator, 2);
});

test("frustration proxy metric tracks retry, recovery, and low score", () => {
  const attempts: KpiAttemptRow[] = [
    {
      status: ATTEMPT_STATUS.COMPLETED,
      durationSec: 60,
      recoveryTriggered: false,
      taskEvaluationJson: { taskScore: 72 },
      nodeOutcomesJson: [],
    },
    {
      status: ATTEMPT_STATUS.NEEDS_RETRY,
      durationSec: null,
      recoveryTriggered: false,
      taskEvaluationJson: { taskScore: 20 },
      nodeOutcomesJson: [],
    },
    {
      status: ATTEMPT_STATUS.COMPLETED,
      durationSec: 50,
      recoveryTriggered: true,
      taskEvaluationJson: { taskScore: 62 },
      nodeOutcomesJson: [],
    },
    {
      status: ATTEMPT_STATUS.COMPLETED,
      durationSec: 45,
      recoveryTriggered: false,
      taskEvaluationJson: { taskScore: 30 },
      nodeOutcomesJson: [],
    },
  ];

  const metric = computeFrustrationProxyMetric({ attempts, windowDays: 30 });
  assert.equal(metric.value, 0.75);
  assert.equal(metric.numerator, 3);
  assert.equal(metric.denominator, 4);
});

test("retention pass metric requires delayed follow-up window", () => {
  const now = new Date("2026-02-17T00:00:00.000Z");
  const rows = [
    {
      studentId: "s1",
      nodeId: "n1",
      createdAt: new Date("2025-09-01T00:00:00.000Z"),
      score: 0.9,
    },
    {
      studentId: "s1",
      nodeId: "n1",
      createdAt: new Date("2025-12-02T00:00:00.000Z"),
      score: 0.85,
    },
    {
      studentId: "s2",
      nodeId: "n2",
      createdAt: new Date("2025-09-05T00:00:00.000Z"),
      score: 0.88,
    },
    {
      studentId: "s2",
      nodeId: "n2",
      createdAt: new Date("2025-12-08T00:00:00.000Z"),
      score: 0.5,
    },
  ];

  const metric = computeRetentionPassRateMetric({
    rows,
    retentionWindowDays: 90,
    now,
  });

  assert.equal(metric.value, 0.5);
  assert.equal(metric.numerator, 1);
  assert.equal(metric.denominator, 2);
});

test("OOD pass rate ignores unknown verdicts", () => {
  const metric = computeOodPassRateMetric({
    rows: [{ verdict: "pass" }, { verdict: "FAILED" }, { verdict: "unclear" }],
    windowDays: 30,
  });
  assert.equal(metric.value, 0.5);
  assert.equal(metric.sampleSize, 2);
});

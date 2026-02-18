import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRetentionProbes,
  summarizeRetentionProbesByWindow,
  computeRetentionConfidence,
  type RetentionEvidenceObservation,
} from "./probes";

const now = new Date("2026-05-01T00:00:00.000Z");

function row(input: {
  studentId?: string;
  nodeId?: string;
  createdAt: string;
  score: number;
}) {
  const value: RetentionEvidenceObservation = {
    studentId: input.studentId || "student-1",
    nodeId: input.nodeId || "node-1",
    createdAt: new Date(input.createdAt),
    score: input.score,
    stage: "A2",
    domain: "grammar",
  };
  return value;
}

test("buildRetentionProbes derives pass/fail/missed/pending outcomes per window", () => {
  const probes = buildRetentionProbes({
    now,
    rows: [
      row({ createdAt: "2026-01-01T00:00:00.000Z", score: 0.9 }),
      row({ createdAt: "2026-01-08T12:00:00.000Z", score: 0.84 }),
      row({ createdAt: "2026-02-01T00:00:00.000Z", score: 0.62 }),
      row({ createdAt: "2026-04-20T00:00:00.000Z", score: 0.88 }),
    ],
  });

  assert.equal(probes.length, 7);

  const bySignature = new Map(
    probes.map((probe) => [
      `${probe.anchorAt.toISOString()}:${probe.windowDays}`,
      probe.status,
    ]),
  );

  assert.equal(
    bySignature.get("2026-01-01T00:00:00.000Z:7"),
    "passed",
  );
  assert.equal(
    bySignature.get("2026-01-01T00:00:00.000Z:30"),
    "failed",
  );
  assert.equal(
    bySignature.get("2026-01-01T00:00:00.000Z:90"),
    "passed",
  );
  assert.equal(
    bySignature.get("2026-04-20T00:00:00.000Z:7"),
    "pending_follow_up",
  );
});

test("summarizeRetentionProbesByWindow aggregates completion and pass rates", () => {
  const probes = buildRetentionProbes({
    now,
    rows: [
      row({ createdAt: "2026-01-01T00:00:00.000Z", score: 0.9 }),
      row({ createdAt: "2026-01-08T12:00:00.000Z", score: 0.84 }),
      row({ createdAt: "2026-02-01T00:00:00.000Z", score: 0.62 }),
      row({ createdAt: "2026-04-20T00:00:00.000Z", score: 0.88 }),
    ],
  });

  const summaries = summarizeRetentionProbesByWindow({ probes });

  const summary7 = summaries.find((row) => row.windowDays === 7);
  const summary30 = summaries.find((row) => row.windowDays === 30);
  const summary90 = summaries.find((row) => row.windowDays === 90);

  assert.ok(summary7);
  assert.ok(summary30);
  assert.ok(summary90);

  assert.equal(summary7!.dueProbeCount, 3);
  assert.equal(summary7!.evaluatedProbeCount, 2);
  assert.equal(summary7!.pendingProbeCount, 1);
  assert.equal(summary7!.passRate, 0.5);
  assert.equal(summary7!.completionRate, 0.666667);

  assert.equal(summary30!.dueProbeCount, 2);
  assert.equal(summary30!.evaluatedProbeCount, 1);
  assert.equal(summary30!.missedFollowUpCount, 1);
  assert.equal(summary30!.failedCount, 1);
  assert.equal(summary30!.passRate, 0);

  assert.equal(summary90!.dueProbeCount, 2);
  assert.equal(summary90!.evaluatedProbeCount, 2);
  assert.equal(summary90!.missedFollowUpCount, 0);
  assert.equal(summary90!.passRate, 1);
  assert.equal(summary90!.completionRate, 1);
});

test("computeRetentionConfidence lowers confidence on low retention health", () => {
  const confidence = computeRetentionConfidence({
    baseConfidence: 0.82,
    windowSummaries: [
      {
        windowDays: 7,
        dueProbeCount: 10,
        pendingProbeCount: 0,
        evaluatedProbeCount: 10,
        passedCount: 3,
        failedCount: 7,
        missedFollowUpCount: 0,
        passRate: 0.3,
        completionRate: 1,
        medianFollowUpLagDays: 8,
      },
      {
        windowDays: 30,
        dueProbeCount: 8,
        pendingProbeCount: 0,
        evaluatedProbeCount: 6,
        passedCount: 2,
        failedCount: 4,
        missedFollowUpCount: 2,
        passRate: 0.333333,
        completionRate: 0.75,
        medianFollowUpLagDays: 32,
      },
      {
        windowDays: 90,
        dueProbeCount: 6,
        pendingProbeCount: 0,
        evaluatedProbeCount: 2,
        passedCount: 1,
        failedCount: 1,
        missedFollowUpCount: 4,
        passRate: 0.5,
        completionRate: 0.333333,
        medianFollowUpLagDays: 92,
      },
    ],
  });

  assert.ok(confidence.confidenceAdjustment < 0);
  assert.ok(confidence.adjustedConfidence < 0.82);
  assert.equal(confidence.totalDueProbeCount, 24);
});

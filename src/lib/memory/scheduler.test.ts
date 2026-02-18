import assert from "node:assert/strict";
import test from "node:test";
import {
  __internal,
  computeFragilityScore,
  MEMORY_FRESH_QUEUE_TYPE,
  MEMORY_REVIEW_QUEUE_TYPE,
  planMemoryQueueItem,
} from "./scheduler";

const NOW = new Date("2026-02-18T00:00:00Z");

function buildRow(overrides?: Partial<Parameters<typeof planMemoryQueueItem>[0]>) {
  return {
    nodeId: "node-1",
    nodeType: "GSE_VOCAB",
    activationState: "observed",
    evidenceCount: 6,
    directEvidenceCount: 4,
    negativeEvidenceCount: 0,
    decayedMastery: 78,
    uncertainty: 0.2,
    halfLifeDays: 14,
    verificationDueAt: null,
    lastEvidenceAt: new Date("2026-02-16T00:00:00Z"),
    ...overrides,
  };
}

test("computeFragilityScore increases for low-mastery uncertain sparse nodes", () => {
  const stable = computeFragilityScore({
    decayedMastery: 82,
    uncertainty: 0.18,
    evidenceCount: 10,
    directEvidenceCount: 8,
    negativeEvidenceCount: 0,
  });
  const fragile = computeFragilityScore({
    decayedMastery: 34,
    uncertainty: 0.76,
    evidenceCount: 1,
    directEvidenceCount: 0,
    negativeEvidenceCount: 1,
  });

  assert.ok(fragile > stable);
  assert.ok(fragile >= 60);
});

test("planMemoryQueueItem emits review queue for overdue nodes", () => {
  const row = buildRow({
    decayedMastery: 48,
    uncertainty: 0.62,
    lastEvidenceAt: new Date("2026-01-28T00:00:00Z"),
    halfLifeDays: 10,
  });

  const plan = planMemoryQueueItem(row, NOW);
  assert.ok(plan);
  assert.equal(plan.queueType, MEMORY_REVIEW_QUEUE_TYPE);
  assert.equal(plan.reasonCode, "memory_overdue");
  assert.equal(plan.dueAt.toISOString(), NOW.toISOString());
  assert.ok(plan.priority <= 55);
});

test("planMemoryQueueItem emits verification_due when due date passed", () => {
  const row = buildRow({
    verificationDueAt: new Date("2026-02-17T00:00:00Z"),
    lastEvidenceAt: new Date("2026-02-17T12:00:00Z"),
    decayedMastery: 72,
    uncertainty: 0.3,
  });

  const plan = planMemoryQueueItem(row, NOW);
  assert.ok(plan);
  assert.equal(plan.queueType, MEMORY_REVIEW_QUEUE_TYPE);
  assert.equal(plan.reasonCode, "verification_due");
  assert.equal(plan.dueAt.toISOString(), NOW.toISOString());
});

test("planMemoryQueueItem emits fresh queue for low-evidence nodes", () => {
  const row = buildRow({
    evidenceCount: 1,
    directEvidenceCount: 0,
    negativeEvidenceCount: 0,
    decayedMastery: 66,
    uncertainty: 0.28,
    lastEvidenceAt: new Date("2026-02-17T20:00:00Z"),
    halfLifeDays: 14,
  });

  const plan = planMemoryQueueItem(row, NOW);
  assert.ok(plan);
  assert.equal(plan.queueType, MEMORY_FRESH_QUEUE_TYPE);
  assert.equal(plan.reasonCode, "fresh_consolidation");
  assert.ok(plan.dueAt.getTime() > NOW.getTime());
});

test("planMemoryQueueItem skips stable non-due nodes", () => {
  const row = buildRow({
    evidenceCount: 7,
    directEvidenceCount: 6,
    decayedMastery: 88,
    uncertainty: 0.12,
    lastEvidenceAt: new Date("2026-02-17T18:00:00Z"),
    halfLifeDays: 14,
  });

  const plan = planMemoryQueueItem(row, NOW);
  assert.equal(plan, null);
});

test("internal median helper returns null for empty set", () => {
  assert.equal(__internal.median([]), null);
  assert.equal(__internal.median([1, 9, 3]), 3);
});

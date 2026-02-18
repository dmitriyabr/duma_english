import assert from "node:assert/strict";
import test from "node:test";
import { evaluateMilestoneStressGate } from "./stressGate";

function probe(params: {
  id: string;
  createdAt: string;
  axisTags: string[];
  verdict: string | null;
  oodTaskScore?: number | null;
}) {
  return {
    oodTaskSpecId: params.id,
    createdAt: new Date(params.createdAt),
    axisTags: params.axisTags,
    verdict: params.verdict,
    metadataJson: {
      transferVerdict: {
        verdict: params.verdict,
        oodTaskScore:
          typeof params.oodTaskScore === "number" ? params.oodTaskScore : null,
      },
    },
  };
}

test("stress gate is not required below B1 milestone floor", () => {
  const result = evaluateMilestoneStressGate({
    targetStage: "A2",
    probes: [],
  });

  assert.equal(result.required, false);
  assert.equal(result.passed, true);
  assert.ok(result.reasonCodes.includes("not_required_for_stage"));
});

test("stress gate passes with two recent passing pairwise combinations and worst-case floor", () => {
  const result = evaluateMilestoneStressGate({
    targetStage: "B1",
    probes: [
      probe({
        id: "ood_1",
        createdAt: "2026-02-18T03:00:00.000Z",
        axisTags: ["topic", "register"],
        verdict: "transfer_pass",
        oodTaskScore: 78,
      }),
      probe({
        id: "ood_2",
        createdAt: "2026-02-18T02:00:00.000Z",
        axisTags: ["interlocutor", "goal"],
        verdict: "transfer_pass",
        oodTaskScore: 74,
      }),
    ],
  });

  assert.equal(result.required, true);
  assert.equal(result.passed, true);
  assert.equal(result.stressSetPairCount, 2);
  assert.equal(result.stressSetPassCount, 2);
  assert.equal(result.worstCaseScore, 74);
  assert.ok(result.reasonCodes.includes("stress_gate_passed"));
});

test("stress gate fails when one pair has validated transfer fail", () => {
  const result = evaluateMilestoneStressGate({
    targetStage: "B2",
    probes: [
      probe({
        id: "ood_1",
        createdAt: "2026-02-18T03:00:00.000Z",
        axisTags: ["topic", "register"],
        verdict: "transfer_fail_validated",
        oodTaskScore: 59,
      }),
      probe({
        id: "ood_2",
        createdAt: "2026-02-18T02:00:00.000Z",
        axisTags: ["interlocutor", "goal"],
        verdict: "transfer_pass",
        oodTaskScore: 76,
      }),
    ],
  });

  assert.equal(result.required, true);
  assert.equal(result.passed, false);
  assert.equal(result.stressSetFailCount, 1);
  assert.ok(result.reasonCodes.includes("stress_probe_failed"));
});

test("stress gate fails when pairwise coverage is insufficient", () => {
  const result = evaluateMilestoneStressGate({
    targetStage: "C1",
    probes: [
      probe({
        id: "ood_1",
        createdAt: "2026-02-18T03:00:00.000Z",
        axisTags: ["topic", "register"],
        verdict: "transfer_pass",
        oodTaskScore: 82,
      }),
    ],
  });

  assert.equal(result.required, true);
  assert.equal(result.passed, false);
  assert.equal(result.stressSetPairCount, 1);
  assert.ok(result.reasonCodes.includes("insufficient_pairwise_combinations"));
});

test("stress gate uses most recent pair observation when duplicates exist", () => {
  const result = evaluateMilestoneStressGate({
    targetStage: "B1",
    probes: [
      probe({
        id: "old_fail",
        createdAt: "2026-02-18T01:00:00.000Z",
        axisTags: ["topic", "register"],
        verdict: "transfer_fail_validated",
        oodTaskScore: 61,
      }),
      probe({
        id: "new_pass",
        createdAt: "2026-02-18T03:30:00.000Z",
        axisTags: ["topic", "register"],
        verdict: "transfer_pass",
        oodTaskScore: 79,
      }),
      probe({
        id: "other_pair",
        createdAt: "2026-02-18T03:00:00.000Z",
        axisTags: ["interlocutor", "goal"],
        verdict: "transfer_pass",
        oodTaskScore: 73,
      }),
    ],
  });

  assert.equal(result.required, true);
  assert.equal(result.passed, true);
  assert.equal(result.stressSetPassCount, 2);
  assert.equal(result.worstCaseScore, 73);
});

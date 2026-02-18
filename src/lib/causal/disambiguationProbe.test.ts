import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDisambiguationProbePlan,
  buildDisambiguationPromptGuidance,
  type DisambiguationProbeRecentTask,
} from "./disambiguationProbe";

function makeTask(metaJson: unknown, createdAt: string): DisambiguationProbeRecentTask {
  return {
    taskType: "qa_prompt",
    createdAt: new Date(createdAt),
    metaJson,
  };
}

test("plan remains disabled when trigger is false", () => {
  const plan = buildDisambiguationProbePlan({
    shouldTrigger: false,
    topCauseLabels: ["rule_confusion", "instruction_misread"],
    recentTasks: [],
    now: new Date("2026-02-18T10:00:00Z"),
  });

  assert.equal(plan.enabled, false);
  assert.equal(plan.reasonCode, "not_triggered");
});

test("retrieval-driven ambiguity selects target_vocab probe", () => {
  const plan = buildDisambiguationProbePlan({
    shouldTrigger: true,
    topCauseLabels: ["retrieval_failure", "production_constraint"],
    recentTasks: [],
    now: new Date("2026-02-18T10:00:00Z"),
  });

  assert.equal(plan.enabled, true);
  assert.equal(plan.selectedTaskType, "target_vocab");
  assert.equal(plan.probeSkill, "vocab_retrieval");
  assert.equal(plan.reasonCode, "ready");
});

test("session budget guard blocks probe when cap reached", () => {
  const plan = buildDisambiguationProbePlan({
    shouldTrigger: true,
    topCauseLabels: ["rule_confusion", "instruction_misread"],
    recentTasks: [
      makeTask(
        {
          causalDisambiguationProbe: {
            enabled: true,
            probeSkill: "instruction_comprehension",
            topCauseLabels: ["rule_confusion", "instruction_misread"],
          },
        },
        "2026-02-18T09:20:00Z"
      ),
      makeTask(
        {
          causalDisambiguationProbe: {
            enabled: true,
            probeSkill: "general_diagnostic",
            topCauseLabels: ["unknown", "mixed"],
          },
        },
        "2026-02-18T09:35:00Z"
      ),
    ],
    now: new Date("2026-02-18T10:00:00Z"),
    budget: { maxPerSession: 2 },
  });

  assert.equal(plan.enabled, false);
  assert.equal(plan.reasonCode, "session_budget_exhausted");
});

test("skill budget guard blocks repeated same-skill probe", () => {
  const plan = buildDisambiguationProbePlan({
    shouldTrigger: true,
    topCauseLabels: ["rule_confusion", "instruction_misread"],
    recentTasks: [
      makeTask(
        {
          causalDisambiguationProbe: {
            enabled: true,
            probeSkill: "instruction_comprehension",
            topCauseLabels: ["rule_confusion", "instruction_misread"],
          },
        },
        "2026-02-18T09:45:00Z"
      ),
    ],
    now: new Date("2026-02-18T10:00:00Z"),
    budget: {
      maxPerSession: 3,
      maxPerSkillPerSession: 1,
    },
  });

  assert.equal(plan.enabled, false);
  assert.equal(plan.reasonCode, "skill_budget_exhausted");
});

test("prompt guidance contains actionable disambiguation constraints", () => {
  const plan = buildDisambiguationProbePlan({
    shouldTrigger: true,
    topCauseLabels: ["l1_interference", "rule_confusion"],
    recentTasks: [],
    now: new Date("2026-02-18T10:00:00Z"),
  });
  const guidance = buildDisambiguationPromptGuidance(plan);
  assert.ok(guidance.length > 0);
  assert.ok(guidance.join(" ").includes("Disambiguation probe mode is ON"));
});

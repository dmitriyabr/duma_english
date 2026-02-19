import test from "node:test";
import assert from "node:assert/strict";
import { generateTaskSpec } from "./taskGenerator";

test("task generator falls back deterministically when OPENAI_API_KEY is missing", async () => {
  const original = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  const spec = await generateTaskSpec({
    taskType: "target_vocab",
    stage: "A1",
    ageBand: "9-11",
    targetWords: ["learn", "friend", "school"],
    targetNodeIds: ["gse:test:vocab:learn"],
    focusSkills: ["vocabulary", "fluency"],
    plannerReason: "Improve target word usage.",
    primaryGoal: "lift_weak_nodes",
  });

  assert.equal(spec.taskType, "target_vocab");
  assert.equal(spec.fallbackUsed, true);
  assert.ok(spec.prompt.includes("learn"));

  if (original) process.env.OPENAI_API_KEY = original;
});

test("task generator with targetNodeLabels uses them in prompt and returns same node IDs in fallback", async () => {
  const original = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  const nodeIds = ["gse:vocab:node1", "gse:grammar:node2"];
  const labels = ["Can use basic school vocabulary.", "Can use present simple in short answers."];
  const spec = await generateTaskSpec({
    taskType: "qa_prompt",
    stage: "A0",
    ageBand: "9-11",
    targetWords: [],
    targetNodeIds: nodeIds,
    targetNodeLabels: labels,
    focusSkills: ["vocabulary", "task_completion"],
    plannerReason: "Lift weak nodes.",
    primaryGoal: "lift_weak_nodes",
  });

  assert.equal(spec.fallbackUsed, true);
  assert.deepEqual(spec.targetNodes, nodeIds);
  assert.ok(spec.prompt.length > 0);

  if (original) process.env.OPENAI_API_KEY = original;
});

test("task generator respects enabled disambiguation probe task override in fallback", async () => {
  const original = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  const spec = await generateTaskSpec({
    taskType: "read_aloud",
    stage: "A1",
    ageBand: "9-11",
    targetWords: ["library", "borrow", "book"],
    targetNodeIds: ["gse:vocab:library"],
    focusSkills: ["vocabulary"],
    plannerReason: "Causal ambiguity trigger selected a diagnostic probe.",
    primaryGoal: "reduce_uncertainty",
    disambiguationProbe: {
      enabled: true,
      reasonCode: "ready",
      selectedTaskType: "target_vocab",
      probeSkill: "vocab_retrieval",
      templateKey: "retrieval_cue_probe",
      topCauseLabels: ["retrieval_failure", "production_constraint"],
      budget: {
        sessionWindowMinutes: 90,
        maxPerSession: 2,
        maxPerSkillPerSession: 1,
        maxPerCausePairPerSession: 1,
        sessionUsed: 0,
        skillUsed: 0,
        causePairUsed: 0,
      },
    },
  });

  assert.equal(spec.fallbackUsed, true);
  assert.equal(spec.taskType, "target_vocab");
  assert.ok(spec.prompt.includes("library") || spec.prompt.includes("borrow"));

  if (original) process.env.OPENAI_API_KEY = original;
});

test("task generator fallback emits structured reading_comprehension prompt", async () => {
  const original = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  const spec = await generateTaskSpec({
    taskType: "reading_comprehension",
    stage: "A2",
    ageBand: "9-11",
    targetWords: [],
    targetNodeIds: ["gse:lo:reading:inference"],
    focusSkills: ["task_completion", "vocabulary"],
    plannerReason: "Collect reading-comprehension evidence.",
    primaryGoal: "reduce_uncertainty",
  });

  assert.equal(spec.taskType, "reading_comprehension");
  assert.equal(spec.fallbackUsed, true);
  assert.equal(/passage:/i.test(spec.prompt), true);
  assert.equal(/question:/i.test(spec.prompt), true);

  if (original) process.env.OPENAI_API_KEY = original;
});

test("task generator fallback supports advanced discourse family prompts", async () => {
  const original = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  const spec = await generateTaskSpec({
    taskType: "argumentation",
    stage: "C1",
    ageBand: "12-14",
    targetWords: [],
    targetNodeIds: ["gse:lo:c1:argument"],
    focusSkills: ["task_completion", "fluency"],
    plannerReason: "Advance discourse practice for C-level learner.",
    primaryGoal: "maintain_progress",
  });

  assert.equal(spec.taskType, "argumentation");
  assert.equal(spec.fallbackUsed, true);
  assert.ok(/position|counterargument|conclusion/i.test(spec.prompt));

  if (original) process.env.OPENAI_API_KEY = original;
});

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

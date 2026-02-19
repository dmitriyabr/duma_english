import test from "node:test";
import assert from "node:assert/strict";
import {
  LISTENING_ASSESSMENT_VERSION,
  evaluateListeningComprehension,
  isListeningTaskType,
} from "./assessment";

test("isListeningTaskType detects listening family", () => {
  assert.equal(isListeningTaskType("listening_comprehension"), true);
  assert.equal(isListeningTaskType("topic_talk"), false);
});

test("evaluateListeningComprehension returns listening rubric checks", () => {
  const assessment = evaluateListeningComprehension({
    taskType: "listening_comprehension",
    taskPrompt:
      "Listen and answer.\nAudio: Ben missed the bus so he called his teacher before class.\nQuestion: Why did Ben call his teacher?",
    transcript:
      "Ben called his teacher because he missed the bus and wanted to explain he would be late.",
  });

  assert.equal(assessment.version, LISTENING_ASSESSMENT_VERSION);
  assert.equal(assessment.rubricChecks.length, 3);
  assert.ok(assessment.scores.comprehension >= 55);
  assert.ok(assessment.scores.sourceGrounding >= 50);
});

test("repair cues increase listening repair behavior score", () => {
  const base = evaluateListeningComprehension({
    taskType: "listening_comprehension",
    taskPrompt:
      "Audio: Maya forgot her notebook and borrowed one from a classmate.\nQuestion: What did Maya borrow?",
    transcript: "Maya borrowed a notebook from her classmate.",
  });

  const withRepair = evaluateListeningComprehension({
    taskType: "listening_comprehension",
    taskPrompt:
      "Audio: Maya forgot her notebook and borrowed one from a classmate.\nQuestion: What did Maya borrow?",
    transcript:
      "Maya borrowed a notebook from her classmate. Sorry, to clarify, she borrowed it because she forgot hers.",
  });

  assert.ok(withRepair.scores.repairBehavior >= base.scores.repairBehavior);
});

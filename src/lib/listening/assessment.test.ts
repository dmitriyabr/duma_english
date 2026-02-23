import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateListeningComprehensionFallback,
  LISTENING_ASSESSMENT_VERSION,
} from "./assessment";

test("listening fallback scores from hidden reference even when prompt has no script", () => {
  const assessment = evaluateListeningComprehensionFallback({
    taskType: "listening_comprehension",
    taskPrompt: "Listen to the audio and answer.\nQuestion: Why did Ben call his teacher?",
    transcript:
      "He called because he missed the bus and wanted to explain he would be late before class.",
    hiddenReference: {
      script:
        "Ben missed the bus, so he called his teacher before class to explain he would be late.",
      question: "Why did Ben call his teacher?",
    },
  });

  assert.equal(assessment.version, LISTENING_ASSESSMENT_VERSION);
  assert.equal(assessment.sourceReference, "task_meta");
  assert.equal(assessment.scores.sourceGrounding >= 35, true);
  assert.equal(assessment.scores.overall >= 55, true);
});

test("listening fallback penalizes question-copy stuffing", () => {
  const assessment = evaluateListeningComprehensionFallback({
    taskType: "listening_comprehension",
    taskPrompt: "Listen to the audio and answer.\nQuestion: Why did Ben call his teacher?",
    transcript: "Why did Ben call his teacher? Why did Ben call his teacher?",
    hiddenReference: {
      script:
        "Ben missed the bus, so he called his teacher before class to explain he would be late.",
      question: "Why did Ben call his teacher?",
    },
  });

  assert.equal(assessment.signals.antiLeakPenalty > 0, true);
  assert.equal(assessment.scores.sourceGrounding < 40, true);
  assert.equal(assessment.scores.overall < 65, true);
});

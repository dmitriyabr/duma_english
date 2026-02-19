import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateReadingComprehension,
  isReadingTaskType,
  READING_ASSESSMENT_VERSION,
} from "./assessment";

test("isReadingTaskType identifies reading family", () => {
  assert.equal(isReadingTaskType("reading_comprehension"), true);
  assert.equal(isReadingTaskType("qa_prompt"), false);
});

test("evaluateReadingComprehension gives high score for grounded answer", () => {
  const assessed = evaluateReadingComprehension({
    taskType: "reading_comprehension",
    taskPrompt:
      "Read the passage and answer in 3-4 sentences.\nPassage: Amina reads library books every evening because stories help her learn new words.\nQuestion: Why does Amina read library books every evening?",
    transcript:
      "Amina reads every evening because stories help her learn new words. She uses library books to improve her vocabulary and understanding.",
  });

  assert.equal(assessed.version, READING_ASSESSMENT_VERSION);
  assert.equal(assessed.scores.overall >= 70, true);
  assert.equal(assessed.rubricChecks.every((row) => row.pass), true);
  assert.equal(assessed.signals.overlappingPassageTokens.length > 0, true);
});

test("evaluateReadingComprehension flags weak off-topic response", () => {
  const assessed = evaluateReadingComprehension({
    taskType: "reading_comprehension",
    taskPrompt:
      "Read the passage and answer in 3-4 sentences.\nPassage: Musa waters the school garden so plants stay healthy in dry weather.\nQuestion: Why does Musa water the school garden?",
    transcript: "I like football and my favorite team won yesterday.",
  });

  assert.equal(assessed.scores.overall < 55, true);
  assert.equal(assessed.rubricChecks.some((row) => !row.pass), true);
});

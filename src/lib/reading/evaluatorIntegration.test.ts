import assert from "node:assert/strict";
import test from "node:test";

import { evaluateTaskQuality } from "@/lib/evaluator";
import { READING_ASSESSMENT_VERSION } from "./assessment";

test("evaluator integrates reading assessment artifacts", async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  const result = await evaluateTaskQuality({
    taskType: "reading_comprehension",
    taskPrompt:
      "Read the passage and answer in 3-4 sentences.\nPassage: Amina reads library books every evening because stories help her learn new words.\nQuestion: Why does Amina read library books every evening?",
    transcript:
      "Amina reads every evening because stories help her learn new words. She uses library books to improve vocabulary.",
    speechMetrics: { speechRate: 112, fillerCount: 0 },
  });

  const artifacts = result.taskEvaluation.artifacts as {
    readingAssessment?: {
      version?: string;
      scores?: {
        overall?: number;
      };
    };
  };

  assert.equal(artifacts.readingAssessment?.version, READING_ASSESSMENT_VERSION);
  assert.equal(typeof artifacts.readingAssessment?.scores?.overall, "number");
  assert.equal(result.taskEvaluation.taskType, "reading_comprehension");

  if (originalKey) process.env.OPENAI_API_KEY = originalKey;
});

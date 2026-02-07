import test from "node:test";
import assert from "node:assert/strict";
import { backfillSemanticEmbeddings, buildSemanticEvaluationContext } from "./semanticAssessor";

test("semantic retrieval context is disabled without OPENAI_API_KEY", async () => {
  const prev = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const result = await buildSemanticEvaluationContext({
    transcript: "I have been to London twice.",
    taskPrompt: "Talk about your travel experience.",
    taskType: "topic_talk",
    stage: "A2",
    ageBand: "9-11",
  });
  assert.equal(result.loCandidates.length, 0);
  assert.equal(result.grammarCandidates.length, 0);
  assert.match(result.disabledReason || "", /OPENAI_API_KEY missing/);
  if (prev) process.env.OPENAI_API_KEY = prev;
});

test("embedding backfill requires OPENAI_API_KEY", async () => {
  const prev = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  await assert.rejects(async () => backfillSemanticEmbeddings({ includeAll: false }), /OPENAI_API_KEY/);
  if (prev) process.env.OPENAI_API_KEY = prev;
});

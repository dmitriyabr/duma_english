import test from "node:test";
import assert from "node:assert/strict";
import { evaluateTaskQuality } from "./evaluator";

test("target_vocab evaluation checks required words and reports missing words", async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  const result = await evaluateTaskQuality({
    taskType: "target_vocab",
    taskPrompt: "Use happy, learn, share, friend.",
    transcript: "I feel happy when I learn with my friend.",
    speechMetrics: {
      speechRate: 120,
      fillerCount: 1,
    },
    taskMeta: { requiredWords: ["happy", "learn", "share", "friend"] },
  });

  const artifacts = result.taskEvaluation.artifacts as {
    requiredWordsUsed?: string[];
    missingWords?: string[];
  };
  assert.equal(result.source, "rules");
  assert.ok((artifacts.requiredWordsUsed || []).includes("happy"));
  assert.ok((artifacts.missingWords || []).includes("share"));

  if (originalKey) process.env.OPENAI_API_KEY = originalKey;
});

test("read_aloud deterministic evaluation exposes pronunciation artifacts", async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  const result = await evaluateTaskQuality({
    taskType: "read_aloud",
    taskPrompt: "Read aloud",
    transcript: "I like going to school because I learn new things.",
    speechMetrics: {
      accuracy: 84,
      fluency: 78,
      completeness: 86,
      prosody: 72,
      confidence: 0.9,
    },
    taskMeta: {
      referenceText: "I like going to school because I learn new things.",
      supportsPronAssessment: true,
    },
  });

  const artifacts = result.taskEvaluation.artifacts as {
    referenceCoverage?: number;
    omittedWords?: string[];
  };
  assert.equal(result.source, "rules");
  assert.ok((artifacts.referenceCoverage || 0) >= 95);
  assert.equal((artifacts.omittedWords || []).length, 0);

  if (originalKey) process.env.OPENAI_API_KEY = originalKey;
});

test("read_aloud does not collapse task score when PA metrics are missing", async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  const result = await evaluateTaskQuality({
    taskType: "read_aloud",
    taskPrompt: "Read aloud",
    transcript: "I like going to school because I learn new things.",
    speechMetrics: {
      confidence: 0.95,
      speechRate: 120,
    },
    taskMeta: {
      referenceText: "I like going to school because I learn new things.",
      supportsPronAssessment: true,
    },
  });

  assert.ok(result.taskEvaluation.taskScore >= 55);

  if (originalKey) process.env.OPENAI_API_KEY = originalKey;
});

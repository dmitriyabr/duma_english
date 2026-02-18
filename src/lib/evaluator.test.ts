import test from "node:test";
import assert from "node:assert/strict";
import { evaluateTaskQuality } from "./evaluator";
import { PERCEPTION_LANGUAGE_SIGNALS_VERSION } from "./perception/languageSignals";

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

test("read_aloud infers referenceText from prompt when taskMeta is missing", async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  const result = await evaluateTaskQuality({
    taskType: "read_aloud",
    taskPrompt: "Read this aloud clearly: 'I learn English every day at school.'",
    transcript: "I learn English every day at school.",
    speechMetrics: {
      confidence: 0.9,
      pronunciation: 94,
      speechRate: 130,
    },
    taskMeta: {
      supportsPronAssessment: true,
    },
  });

  const artifacts = result.taskEvaluation.artifacts as {
    referenceCoverage?: number;
    insertedWords?: string[];
  };
  assert.ok((artifacts.referenceCoverage || 0) >= 95);
  assert.equal((artifacts.insertedWords || []).length, 0);

  if (originalKey) process.env.OPENAI_API_KEY = originalKey;
});

test("target_vocab prefers prompt words over stale taskMeta words", async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  const result = await evaluateTaskQuality({
    taskType: "target_vocab",
    taskPrompt: "Use those words trees, clean, recycle, river",
    transcript: "We cleaned the river and recycle trash near trees.",
    speechMetrics: {
      confidence: 0.85,
      speechRate: 120,
    },
    taskMeta: {
      requiredWords: ["trees", "clean", "recycle", "river", "community", "practice"],
    },
  });

  const artifacts = result.taskEvaluation.artifacts as {
    missingWords?: string[];
    requiredWordsUsed?: string[];
  };
  assert.equal((artifacts.missingWords || []).includes("community"), false);
  assert.equal((artifacts.missingWords || []).includes("practice"), false);
  assert.ok((artifacts.requiredWordsUsed || []).includes("trees"));
  assert.ok((artifacts.requiredWordsUsed || []).includes("recycle"));

  if (originalKey) process.env.OPENAI_API_KEY = originalKey;
});

test("evaluateTaskQuality falls back to rules when OPENAI_API_KEY is missing", async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  const result = await evaluateTaskQuality({
    taskType: "qa_prompt",
    taskPrompt: "What do you like to do at weekends?",
    transcript: "I like to play football and read books.",
    speechMetrics: { speechRate: 110, fillerCount: 0 },
  });

  assert.equal(result.source, "rules");
  assert.ok(Array.isArray(result.taskEvaluation.loChecks));
  assert.ok(Array.isArray(result.taskEvaluation.grammarChecks));
  assert.ok(Array.isArray(result.taskEvaluation.vocabChecks));
  assert.ok(typeof result.feedback.summary === "string");

  if (originalKey) process.env.OPENAI_API_KEY = originalKey;
});

test("evaluateTaskQuality attaches perception language and code-switch signals", async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  const result = await evaluateTaskQuality({
    taskType: "qa_prompt",
    taskPrompt: "Tell me about your day.",
    transcript: "I am happy lakini leo niko sawa manze and my msee is here.",
    speechMetrics: { speechRate: 118, fillerCount: 0 },
  });

  const artifacts = result.taskEvaluation.artifacts as {
    languageSignals?: {
      version?: string;
      primaryTag?: string;
      codeSwitch?: {
        detected?: boolean;
      };
    };
  };
  assert.equal(artifacts.languageSignals?.version, PERCEPTION_LANGUAGE_SIGNALS_VERSION);
  assert.equal(artifacts.languageSignals?.primaryTag, "english");
  assert.equal(artifacts.languageSignals?.codeSwitch?.detected, true);

  if (originalKey) process.env.OPENAI_API_KEY = originalKey;
});

test("evaluateTaskQuality attaches discourse pragmatics dimensions for discourse tasks", async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  const result = await evaluateTaskQuality({
    taskType: "topic_talk",
    taskPrompt: "Give a formal short presentation for your teacher.",
    transcript:
      "I think school clubs are important because they build teamwork. For example, in our debate club we practice speaking. Therefore, every class should have one. In conclusion, clubs help students and teachers.",
    speechMetrics: { speechRate: 108, fillerCount: 0 },
  });

  const artifacts = result.taskEvaluation.artifacts as {
    discoursePragmatics?: {
      version?: string;
      scores?: Record<string, number>;
    };
  };
  const rubricNames = result.taskEvaluation.rubricChecks.map((check) => check.name);

  assert.equal(artifacts.discoursePragmatics?.version, "discourse-pragmatics-v1");
  assert.equal(typeof artifacts.discoursePragmatics?.scores?.argumentStructure, "number");
  assert.equal(rubricNames.includes("argument_structure"), true);
  assert.equal(rubricNames.includes("register_control"), true);
  assert.equal(rubricNames.includes("turn_taking_repair"), true);
  assert.equal(rubricNames.includes("cohesion"), true);
  assert.equal(rubricNames.includes("audience_fit"), true);

  if (originalKey) process.env.OPENAI_API_KEY = originalKey;
});

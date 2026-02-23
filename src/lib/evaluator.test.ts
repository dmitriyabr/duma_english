import test from "node:test";
import assert from "node:assert/strict";
import { evaluateTaskQuality } from "./evaluator";
import { PERCEPTION_LANGUAGE_SIGNALS_VERSION } from "./perception/languageSignals";
import { READING_ASSESSMENT_VERSION } from "./reading/assessment";

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

test("deterministic fallback keeps advanced discourse task-specific artifacts", async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  const argumentation = await evaluateTaskQuality({
    taskType: "argumentation",
    taskPrompt: "Argue for or against school uniforms.",
    transcript:
      "I think uniforms should stay because they reduce pressure. However, some students want more style, so schools can allow one free-style day.",
    speechMetrics: { speechRate: 108, fillerCount: 0 },
  });
  const registerSwitch = await evaluateTaskQuality({
    taskType: "register_switch",
    taskPrompt: "Say one formal and one casual version.",
    transcript:
      "Formal: I would appreciate an extension until tomorrow. Casual: Hey, can I get one more day?",
    speechMetrics: { speechRate: 106, fillerCount: 0 },
  });
  const repair = await evaluateTaskQuality({
    taskType: "misunderstanding_repair",
    taskPrompt: "Repair a misunderstanding politely.",
    transcript:
      "Sorry, I meant Tuesday. Could you repeat the date? Okay, got it, Tuesday.",
    speechMetrics: { speechRate: 102, fillerCount: 0 },
  });

  const argumentationArtifacts = argumentation.taskEvaluation.artifacts as Record<string, unknown>;
  const registerArtifacts = registerSwitch.taskEvaluation.artifacts as Record<string, unknown>;
  const repairArtifacts = repair.taskEvaluation.artifacts as Record<string, unknown>;

  assert.equal(typeof argumentationArtifacts.argumentStructureScore, "number");
  assert.equal(typeof registerArtifacts.registerSwitchDetected, "boolean");
  assert.equal(typeof repairArtifacts.repairCueCount, "number");
  assert.equal(argumentation.taskEvaluation.taskType, "argumentation");
  assert.equal(registerSwitch.taskEvaluation.taskType, "register_switch");
  assert.equal(repair.taskEvaluation.taskType, "misunderstanding_repair");

  if (originalKey) process.env.OPENAI_API_KEY = originalKey;
});

test("writing_prompt deterministic evaluation emits writing artifacts and rewrite recommendation", async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  const result = await evaluateTaskQuality({
    taskType: "writing_prompt",
    taskPrompt:
      "Write 5-7 sentences about a school challenge you solved. Include what happened, what you did, and what changed.",
    transcript:
      "Last week our team could not finish a science poster because we had too many ideas and no clear order. I suggested that we split the work into small parts. Then I organized the timeline and checked each section. Finally, we finished on time and explained our project clearly to the class.",
    speechMetrics: { wordCount: 62, durationSec: 160, speechRate: 23 },
  });

  const artifacts = result.taskEvaluation.artifacts as {
    writingWordCount?: number;
    writingSentenceCount?: number;
    writingConnectorCount?: number;
    rewriteRecommended?: boolean;
  };

  assert.equal(result.source, "rules");
  assert.ok((artifacts.writingWordCount || 0) >= 45);
  assert.equal(artifacts.writingSentenceCount, 4);
  assert.ok((artifacts.writingConnectorCount || 0) >= 1);
  assert.equal(artifacts.rewriteRecommended, true);

  if (originalKey) process.env.OPENAI_API_KEY = originalKey;
});

test("evaluateTaskQuality attaches reading assessment artifacts for reading tasks", async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  const result = await evaluateTaskQuality({
    taskType: "reading_comprehension",
    taskPrompt:
      "Read the passage and answer in 3-4 sentences.\\nPassage: Amina reads library books every evening because stories help her learn new words.\\nQuestion: Why does Amina read library books every evening?",
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
  assert.equal(result.taskEvaluation.taskScore >= 60, true);

  if (originalKey) process.env.OPENAI_API_KEY = originalKey;
});

test("evaluateTaskQuality attaches listening assessment artifacts for listening tasks", async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  const result = await evaluateTaskQuality({
    taskType: "listening_comprehension",
    taskPrompt:
      "Listen and answer.\\nAudio: Ben missed the bus so he called his teacher before class.\\nQuestion: Why did Ben call his teacher?",
    transcript:
      "Ben called his teacher because he missed the bus and wanted to explain he would be late. Sorry, to clarify, he called before class.",
    speechMetrics: { speechRate: 104, fillerCount: 0 },
  });

  const artifacts = result.taskEvaluation.artifacts as {
    listeningAssessment?: {
      version?: string;
      sourceReference?: string;
      scores?: {
        overall?: number;
      };
    };
    listeningRepairBehaviorScore?: number;
    listeningEvaluationMode?: string;
  };
  assert.equal(artifacts.listeningAssessment?.version, "listening-assessment-v2");
  assert.equal(typeof artifacts.listeningAssessment?.scores?.overall, "number");
  assert.equal(
    artifacts.listeningAssessment?.sourceReference === "task_meta" ||
      artifacts.listeningAssessment?.sourceReference === "prompt_parse",
    true,
  );
  assert.equal(
    artifacts.listeningEvaluationMode === "llm" ||
      artifacts.listeningEvaluationMode === "fallback",
    true,
  );
  assert.equal(typeof artifacts.listeningRepairBehaviorScore, "number");
  assert.equal(result.taskEvaluation.taskScore >= 60, true);

  if (originalKey) process.env.OPENAI_API_KEY = originalKey;
});

test("evaluateTaskQuality uses hidden listening reference from task meta when prompt has no script", async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  const result = await evaluateTaskQuality({
    taskType: "listening_comprehension",
    taskPrompt: "Listen to the audio and answer.\\nQuestion: Why did Ben call his teacher?",
    transcript:
      "He called because he missed the bus and wanted to explain he would be late before class.",
    speechMetrics: { speechRate: 106, fillerCount: 0 },
    taskMeta: {
      listeningScript:
        "Ben missed the bus, so he called his teacher before class to explain he would be late.",
      listeningQuestion: "Why did Ben call his teacher?",
    },
  });

  const artifacts = result.taskEvaluation.artifacts as {
    listeningAssessment?: {
      sourceReference?: string;
      script?: string;
    };
  };
  assert.equal(artifacts.listeningAssessment?.sourceReference, "task_meta");
  assert.equal(
    String(artifacts.listeningAssessment?.script || "").includes("missed the bus"),
    true,
  );
  assert.equal(result.taskEvaluation.taskScore >= 55, true);

  if (originalKey) process.env.OPENAI_API_KEY = originalKey;
});

import { z } from "zod";
import { SpeechMetrics } from "./scoring";
import { extractReferenceText, extractRequiredWords } from "./taskText";
import { chatJson } from "./llm";
import { buildSemanticEvaluationContext } from "./gse/semanticAssessor";
import { buildVocabEvaluationContext } from "./gse/vocabRetrieval";
import { appendPipelineDebugEvent, previewText } from "./pipelineDebugLog";

export type RubricCheck = {
  name: string;
  pass: boolean;
  reason: string;
  weight: number;
};

export type LoCheck = {
  checkId: string;
  label: string;
  pass: boolean;
  confidence: number;
  severity: "low" | "medium" | "high";
  evidenceSpan?: string;
};

export type GrammarCheck = {
  checkId: string;
  descriptorId?: string;
  label: string;
  pass: boolean;
  confidence: number;
  opportunityType: "explicit_target" | "elicited_incidental" | "incidental";
  errorType?: string;
  evidenceSpan?: string;
  correction?: string;
};

export type VocabCheck = {
  nodeId: string;
  label: string;
  pass: boolean;
  confidence: number;
  opportunityType: "explicit_target" | "incidental";
  evidenceSpan?: string;
  matchedPhrase?: string;
};

export type TaskEvaluation = {
  taskType: string;
  taskScore: number;
  languageScore?: number;
  artifacts: Record<string, unknown>;
  rubricChecks: RubricCheck[];
  loChecks: LoCheck[];
  grammarChecks: GrammarCheck[];
  vocabChecks: VocabCheck[];
  evidence: string[];
  modelVersion: string;
};

export type FeedbackResult = {
  summary: string;
  whatWentWell: string[];
  whatToFixNow: string[];
  exampleBetterAnswer: string;
  nextMicroTask: string;
};

export type EvaluationDebugInfo = {
  openai: {
    enabled: boolean;
    model: string;
    attempts: Array<{
      try: number;
      status: number | null;
      ok: boolean;
      parseOk: boolean;
      parseError?: string;
      responsePreview?: string;
    }>;
    finalSource: "openai" | "rules";
    reason?: string;
  };
  promptPreview: string;
};

export type EvaluationInput = {
  taskId?: string;
  taskType: string;
  taskPrompt: string;
  transcript: string;
  speechMetrics: SpeechMetrics;
  constraints?: { minSeconds?: number; maxSeconds?: number } | null;
  taskMeta?: Record<string, unknown> | null;
  taskTargets?: Array<{
    nodeId: string;
    weight: number;
    required: boolean;
    node: {
      nodeId: string;
      type: "GSE_LO" | "GSE_VOCAB" | "GSE_GRAMMAR";
      sourceKey: string;
      descriptor: string;
    };
  }>;
};

const MODEL_VERSION = "eval-v2";

const SPLIT_LO_CANDIDATES = 16;
const SPLIT_GRAMMAR_CANDIDATES = 14;
const SPLIT_VOCAB_CANDIDATES = 20;
const SPLIT_LO_CHECKS_MAX = 8;
const SPLIT_GRAMMAR_CHECKS_MAX = 10;
const SPLIT_VOCAB_CHECKS_MAX = 12;

function getEvaluationLimits(taskMeta?: Record<string, unknown> | null) {
  const isPlacementExtended = taskMeta?.placementMode === "placement_extended";

  if (isPlacementExtended) {
    return {
      TRANSCRIPT_MAX_CHARS: 3000,
      SPLIT_LO_CANDIDATES: 30,
      SPLIT_GRAMMAR_CANDIDATES: 25,
      SPLIT_VOCAB_CANDIDATES: 35,
      SPLIT_LO_CHECKS_MAX: 15,
      SPLIT_GRAMMAR_CHECKS_MAX: 18,
      SPLIT_VOCAB_CHECKS_MAX: 20,
      TOKEN_BUDGET_LO: 2500,
      TOKEN_BUDGET_GRAMMAR: 2800,
      TOKEN_BUDGET_VOCAB: 2800,
    };
  }

  return {
    TRANSCRIPT_MAX_CHARS: 900,
    SPLIT_LO_CANDIDATES: SPLIT_LO_CANDIDATES,
    SPLIT_GRAMMAR_CANDIDATES: SPLIT_GRAMMAR_CANDIDATES,
    SPLIT_VOCAB_CANDIDATES: SPLIT_VOCAB_CANDIDATES,
    SPLIT_LO_CHECKS_MAX: SPLIT_LO_CHECKS_MAX,
    SPLIT_GRAMMAR_CHECKS_MAX: SPLIT_GRAMMAR_CHECKS_MAX,
    SPLIT_VOCAB_CHECKS_MAX: SPLIT_VOCAB_CHECKS_MAX,
    TOKEN_BUDGET_LO: 1200,
    TOKEN_BUDGET_GRAMMAR: 1400,
    TOKEN_BUDGET_VOCAB: 1400,
  };
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

function deriveLoChecks(taskEvaluation: TaskEvaluation, transcript: string): LoCheck[] {
  const fromModel = Array.isArray(taskEvaluation.loChecks) ? taskEvaluation.loChecks : [];
  if (fromModel.length > 0) return fromModel.slice(0, 8);

  const fallback: LoCheck[] = taskEvaluation.rubricChecks.map((check, index) => ({
    checkId: slugify(check.name || `lo_check_${index + 1}`),
    label: check.name || `LO check ${index + 1}`,
    pass: Boolean(check.pass),
    confidence: Math.max(0.55, Math.min(0.95, 0.55 + check.weight * 0.4)),
    severity: (check.pass ? "low" : check.weight >= 0.4 ? "high" : "medium") as LoCheck["severity"],
    evidenceSpan: transcript.slice(0, 160),
  }));

  // Enforce consistency rule: low score with explicit opportunity must include negative LO signal.
  if (taskEvaluation.taskScore <= 45 && !fallback.some((item) => !item.pass)) {
    fallback.push({
      checkId: "lo_check_negative_required",
      label: "Core task objective not met",
      pass: false,
      confidence: 0.9,
      severity: "high",
      evidenceSpan: transcript.slice(0, 160),
    });
  }
  return fallback.slice(0, 8);
}

function deriveGrammarChecks(taskEvaluation: TaskEvaluation): GrammarCheck[] {
  const fromModel = Array.isArray(taskEvaluation.grammarChecks) ? taskEvaluation.grammarChecks : [];
  if (fromModel.length > 0) return fromModel.slice(0, 10);
  // Grammar node updates are model-driven only.
  return [];
}

function deriveVocabChecks(taskEvaluation: TaskEvaluation): VocabCheck[] {
  const fromModel = Array.isArray(taskEvaluation.vocabChecks) ? taskEvaluation.vocabChecks : [];
  if (fromModel.length > 0) return fromModel.slice(0, 14);
  return [];
}

function attachStructuredChecks(taskEvaluation: TaskEvaluation, transcript: string): TaskEvaluation {
  return {
    ...taskEvaluation,
    loChecks: deriveLoChecks(taskEvaluation, transcript),
    grammarChecks: deriveGrammarChecks(taskEvaluation),
    vocabChecks: deriveVocabChecks(taskEvaluation),
  };
}

function normalizeWords(input: string) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function splitSentences(input: string) {
  return input
    .split(/[.!?]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function resolveRequiredWords(input: EvaluationInput) {
  const fromPrompt = extractRequiredWords(input.taskPrompt);
  const fromMeta = Array.isArray(input.taskMeta?.requiredWords)
    ? input.taskMeta.requiredWords
        .map((word) => String(word).toLowerCase().trim())
        .filter((word) => /^[a-z][a-z'-]*$/.test(word))
    : [];
  if (fromPrompt.length >= 2) return fromPrompt;
  if (fromMeta.length > 0) return fromMeta;
  return fromPrompt;
}

function scoreFromChecks(checks: RubricCheck[]) {
  const totalWeight = checks.reduce((sum, c) => sum + c.weight, 0) || 1;
  const passedWeight = checks.filter((c) => c.pass).reduce((sum, c) => sum + c.weight, 0);
  return clamp(Math.round((passedWeight / totalWeight) * 100));
}

export function computeLanguageScoreFromTaskEvaluation(taskEvaluation: TaskEvaluation) {
  if (typeof taskEvaluation.languageScore === "number") {
    return clamp(taskEvaluation.languageScore);
  }

  const wordsUsed = taskEvaluation.artifacts.requiredWordsUsed;
  const usageCorrectness = taskEvaluation.artifacts.wordUsageCorrectness;
  if (Array.isArray(wordsUsed) && typeof usageCorrectness === "number") {
    const lexicalRichness = clamp((wordsUsed.length / Math.max(wordsUsed.length + 1, 4)) * 100);
    return Math.round(clamp(usageCorrectness * 0.75 + lexicalRichness * 0.25));
  }

  const passRatio = scoreFromChecks(taskEvaluation.rubricChecks);
  return Math.round(clamp(passRatio * 0.9 + 10));
}

function buildFeedbackFromEvaluation(
  taskEvaluation: TaskEvaluation,
  fallbackExample: string,
  transcript: string
): FeedbackResult {
  const passed = taskEvaluation.rubricChecks.filter((c) => c.pass);
  const failed = taskEvaluation.rubricChecks.filter((c) => !c.pass);
  const weakest = failed.sort((a, b) => b.weight - a.weight)[0];
  const hasStrongAnswer = taskEvaluation.taskScore >= 85 && failed.length === 0;

  return {
    summary:
      taskEvaluation.taskScore >= 80
        ? "Strong task execution. Keep your clarity and structure."
        : "You are close. Focus on the key task requirements next.",
    whatWentWell: passed.slice(0, 3).map((c) => c.reason).filter(Boolean).length
      ? passed.slice(0, 3).map((c) => c.reason)
      : ["You completed the attempt and stayed on task."],
    whatToFixNow: failed.slice(0, 3).map((c) => c.reason).filter(Boolean).length
      ? failed.slice(0, 3).map((c) => c.reason)
      : ["Keep improving clarity and structure."],
    exampleBetterAnswer: hasStrongAnswer ? transcript : fallbackExample,
    nextMicroTask: weakest
      ? `Retry and focus on: ${weakest.name}.`
      : "Retry and keep the same structure with clearer delivery.",
  };
}

function evaluateReadAloud(input: EvaluationInput): { taskEvaluation: TaskEvaluation; feedback: FeedbackResult } {
  const referenceText = String(input.taskMeta?.referenceText || extractReferenceText(input.taskPrompt) || "");
  const refWords = normalizeWords(referenceText);
  const saidWords = normalizeWords(input.transcript);
  const saidSet = new Set(saidWords);
  const refSet = new Set(refWords);
  const omittedWords = refWords.filter((w) => !saidSet.has(w));
  const insertedWords = saidWords.filter((w) => !refSet.has(w));
  const coverage = refWords.length ? (refWords.length - omittedWords.length) / refWords.length : 0;
  const paValues = [
    input.speechMetrics.pronunciationTargetRef,
    input.speechMetrics.pronunciation,
    input.speechMetrics.accuracy,
    input.speechMetrics.fluency,
    input.speechMetrics.completeness,
    input.speechMetrics.prosody,
  ].filter((value): value is number => typeof value === "number");
  const hasPa = paValues.length > 0;

  const checks: RubricCheck[] = [
    {
      name: "reference_coverage",
      pass: coverage >= 0.8,
      reason: coverage >= 0.8 ? "You covered most of the target sentence." : "You missed several target words.",
      weight: 0.45,
    },
    {
      name: "accuracy_score",
      pass: !hasPa || (input.speechMetrics.accuracy ?? 0) >= 70,
      reason:
        !hasPa
          ? "Pronunciation metrics are unavailable for this attempt."
          : (input.speechMetrics.accuracy ?? 0) >= 70
          ? "Pronunciation accuracy is at a good level."
          : "Work on word-level pronunciation accuracy.",
      weight: 0.35,
    },
    {
      name: "fluency_score",
      pass: !hasPa || (input.speechMetrics.fluency ?? 0) >= 65,
      reason:
        !hasPa
          ? "Fluency metrics are unavailable for this attempt."
          : (input.speechMetrics.fluency ?? 0) >= 65
          ? "Your reading flow is mostly smooth."
          : "Try to read in a smoother rhythm.",
      weight: 0.2,
    },
  ];

  const paAverage = hasPa ? paValues.reduce((sum, value) => sum + value, 0) / paValues.length : null;
  const fallbackTaskScore = scoreFromChecks(checks);
  const taskScore =
    paAverage === null
      ? fallbackTaskScore
      : Math.round(clamp(paAverage * 0.8 + coverage * 100 * 0.2));

  const taskEvaluation: TaskEvaluation = {
    taskType: input.taskType,
    taskScore,
    languageScore: Math.round(clamp((input.speechMetrics.completeness ?? taskScore) * 0.6 + coverage * 40)),
    artifacts: {
      referenceCoverage: Number((coverage * 100).toFixed(1)),
      omittedWords: omittedWords.slice(0, 8),
      insertedWords: insertedWords.slice(0, 8),
      mispronouncedHotspots: omittedWords.slice(0, 5),
    },
    rubricChecks: checks,
    loChecks: [],
    grammarChecks: [],
    vocabChecks: [],
    evidence: [input.transcript.slice(0, 200)],
    modelVersion: MODEL_VERSION,
  };

  const feedback = buildFeedbackFromEvaluation(
    taskEvaluation,
    referenceText || "Read the target sentence again with clear pauses.",
    input.transcript
  );
  return { taskEvaluation, feedback };
}

function evaluateTargetVocab(input: EvaluationInput): { taskEvaluation: TaskEvaluation; feedback: FeedbackResult } {
  const requiredWords = resolveRequiredWords(input);
  const transcriptLower = input.transcript.toLowerCase();
  const requiredWordsUsed = requiredWords.filter((word) =>
    new RegExp(`\\b${word}\\w*\\b`, "i").test(transcriptLower)
  );
  const missingWords = requiredWords.filter((w) => !requiredWordsUsed.includes(w));
  const usageRatio = requiredWords.length ? requiredWordsUsed.length / requiredWords.length : 0;

  const checks: RubricCheck[] = [
    {
      name: "required_words_used",
      pass: usageRatio >= 0.75,
      reason:
        usageRatio >= 0.75
          ? "You used most target words."
          : "Use more of the required words in your answer.",
      weight: 0.6,
    },
    {
      name: "contextual_usage",
      pass: requiredWordsUsed.length >= 2 && splitSentences(input.transcript).length >= 2,
      reason:
        requiredWordsUsed.length >= 2 && splitSentences(input.transcript).length >= 2
          ? "The words are used in meaningful sentences."
          : "Use target words in full, meaningful sentences.",
      weight: 0.4,
    },
  ];

  const taskEvaluation: TaskEvaluation = {
    taskType: input.taskType,
    taskScore: scoreFromChecks(checks),
    languageScore: Math.round(clamp(usageRatio * 100)),
    artifacts: {
      requiredWordsUsed,
      wordUsageCorrectness: Number((usageRatio * 100).toFixed(1)),
      inflectedFormsAccepted: requiredWordsUsed,
      missingWords,
    },
    rubricChecks: checks,
    loChecks: [],
    grammarChecks: [],
    vocabChecks: [],
    evidence: [input.transcript.slice(0, 220)],
    modelVersion: MODEL_VERSION,
  };

  const feedback = buildFeedbackFromEvaluation(
    taskEvaluation,
    "I feel happy when I learn new things. I can share ideas with my friend.",
    input.transcript
  );
  return { taskEvaluation, feedback };
}

function evaluateRolePlay(input: EvaluationInput): { taskEvaluation: TaskEvaluation; feedback: FeedbackResult } {
  const text = input.transcript.toLowerCase();
  const questions = (input.transcript.match(/\?/g) || []).length;
  const greeting = /\b(hello|hi|good morning|good afternoon)\b/.test(text);
  const politeness = /\b(please|thank you|nice to meet you|welcome)\b/.test(text);
  const requiredActs = Array.isArray(input.taskMeta?.requiredActs)
    ? input.taskMeta.requiredActs.map((value) => String(value))
    : ["greeting", "two_questions"];
  const requiredActsCompleted = [
    greeting ? "greeting" : null,
    questions >= 2 ? "two_questions" : null,
    politeness ? "politeness" : null,
  ].filter((value): value is string => Boolean(value));
  const requiredActsDone = requiredActs.filter((value) => requiredActsCompleted.includes(value));

  const checks: RubricCheck[] = [
    {
      name: "greeting",
      pass: !requiredActs.includes("greeting") || greeting,
      reason: greeting ? "You opened with a greeting." : "Start with a clear greeting.",
      weight: 0.35,
    },
    {
      name: "questioning",
      pass: !requiredActs.includes("two_questions") || questions >= 2,
      reason: questions >= 2 ? "You asked enough questions." : "Ask at least two friendly questions.",
      weight: 0.4,
    },
    {
      name: "politeness",
      pass: politeness,
      reason: politeness ? "Your tone is polite and welcoming." : "Add polite phrases to sound welcoming.",
      weight: 0.25,
    },
  ];

  const taskEvaluation: TaskEvaluation = {
    taskType: input.taskType,
    taskScore: scoreFromChecks(checks),
    languageScore: Math.round(clamp(55 + (requiredActsDone.length / Math.max(requiredActs.length, 1)) * 45)),
    artifacts: {
      requiredActsCompleted: requiredActsDone,
      turnSimulationQuality: scoreFromChecks(checks),
      politenessMarkers: Array.from(text.match(/\b(please|thank you|welcome|nice)\b/g) || []),
    },
    rubricChecks: checks,
    loChecks: [],
    grammarChecks: [],
    vocabChecks: [],
    evidence: [input.transcript.slice(0, 220)],
    modelVersion: MODEL_VERSION,
  };

  const feedback = buildFeedbackFromEvaluation(
    taskEvaluation,
    "Hi there. Welcome to our school. What do you enjoy learning? Do you have a favorite subject?",
    input.transcript
  );
  return { taskEvaluation, feedback };
}

function evaluateQAPrompt(input: EvaluationInput): { taskEvaluation: TaskEvaluation; feedback: FeedbackResult } {
  const sentences = splitSentences(input.transcript);
  const firstSentence = sentences[0] || "";
  const questionAnswered = normalizeWords(input.transcript).length >= 10;
  const directAnswerFirst = normalizeWords(firstSentence).length >= 4;
  const supportingReasons = (input.transcript.match(/\b(because|so|then|after)\b/gi) || []).length;
  const irrelevantSegments: string[] = [];

  const checks: RubricCheck[] = [
    {
      name: "question_answered",
      pass: questionAnswered,
      reason: questionAnswered ? "You gave a direct answer." : "Answer the question more directly.",
      weight: 0.45,
    },
    {
      name: "direct_answer_first",
      pass: directAnswerFirst,
      reason: directAnswerFirst ? "You started with a direct point." : "Start with your direct answer first.",
      weight: 0.25,
    },
    {
      name: "supporting_reasons",
      pass: supportingReasons >= 1,
      reason: supportingReasons >= 1 ? "You added supporting details." : "Add one reason or example.",
      weight: 0.3,
    },
  ];

  const taskEvaluation: TaskEvaluation = {
    taskType: input.taskType,
    taskScore: scoreFromChecks(checks),
    languageScore: Math.round(clamp(50 + supportingReasons * 12 + (directAnswerFirst ? 12 : 0))),
    artifacts: {
      questionAnswered,
      directAnswerFirst,
      supportingReasons,
      irrelevantSegments,
    },
    rubricChecks: checks,
    loChecks: [],
    grammarChecks: [],
    vocabChecks: [],
    evidence: [firstSentence, sentences[1] || ""].filter(Boolean),
    modelVersion: MODEL_VERSION,
  };

  const feedback = buildFeedbackFromEvaluation(
    taskEvaluation,
    "After school, I usually finish homework, play football, and read for 20 minutes.",
    input.transcript
  );
  return { taskEvaluation, feedback };
}

function evaluateTopicTalk(input: EvaluationInput): { taskEvaluation: TaskEvaluation; feedback: FeedbackResult } {
  const text = input.transcript.toLowerCase();
  const mainPointDetected = normalizeWords(input.transcript).length >= 12;
  const supportingDetailCount = (text.match(/\b(because|for example|for instance|when)\b/g) || []).length;
  const coherenceSignals = Array.from(text.match(/\b(first|then|because|so|finally)\b/g) || []);
  const offTopicRatio = 0;

  const checks: RubricCheck[] = [
    {
      name: "main_point_detected",
      pass: mainPointDetected,
      reason: mainPointDetected ? "You expressed a clear main point." : "State your main point clearly.",
      weight: 0.35,
    },
    {
      name: "supporting_detail_count",
      pass: supportingDetailCount >= 1,
      reason: supportingDetailCount >= 1 ? "You gave supporting details." : "Add at least one supporting detail.",
      weight: 0.35,
    },
    {
      name: "coherence",
      pass: coherenceSignals.length >= 1,
      reason: coherenceSignals.length >= 1 ? "Your talk had linking signals." : "Use linking words to organize ideas.",
      weight: 0.3,
    },
  ];

  const taskEvaluation: TaskEvaluation = {
    taskType: input.taskType,
    taskScore: scoreFromChecks(checks),
    languageScore: Math.round(clamp(52 + supportingDetailCount * 10 + coherenceSignals.length * 6)),
    artifacts: {
      mainPointDetected,
      supportingDetailCount,
      offTopicRatio,
      coherenceSignals,
    },
    rubricChecks: checks,
    loChecks: [],
    grammarChecks: [],
    vocabChecks: [],
    evidence: [input.transcript.slice(0, 220)],
    modelVersion: MODEL_VERSION,
  };

  const feedback = buildFeedbackFromEvaluation(
    taskEvaluation,
    "My favorite place to play is the school field because I can run with my friends.",
    input.transcript
  );
  return { taskEvaluation, feedback };
}

function evaluateFillerControl(input: EvaluationInput): { taskEvaluation: TaskEvaluation; feedback: FeedbackResult } {
  const words = normalizeWords(input.transcript);
  const fillers = words.filter((w) => ["um", "uh", "like"].includes(w));
  const fillerDensityPer100Words = words.length ? Number(((fillers.length / words.length) * 100).toFixed(2)) : 0;
  const topFillers = Array.from(new Set(fillers)).slice(0, 3);
  const selfCorrections = (input.transcript.match(/\b(i mean|sorry|let me)\b/gi) || []).length;

  const checks: RubricCheck[] = [
    {
      name: "filler_density",
      pass: fillerDensityPer100Words <= 4,
      reason:
        fillerDensityPer100Words <= 4
          ? "You kept filler words low."
          : "Reduce filler words to sound cleaner.",
      weight: 0.55,
    },
    {
      name: "steady_flow",
      pass: (input.speechMetrics.speechRate ?? 0) >= 90,
      reason:
        (input.speechMetrics.speechRate ?? 0) >= 90
          ? "Your speech flow is steady."
          : "Speak a little more steadily.",
      weight: 0.2,
    },
    {
      name: "self_corrections",
      pass: selfCorrections <= 2,
      reason:
        selfCorrections <= 2
          ? "You had few self-corrections."
          : "Try to reduce restarts and self-corrections.",
      weight: 0.25,
    },
  ];

  const taskEvaluation: TaskEvaluation = {
    taskType: input.taskType,
    taskScore: scoreFromChecks(checks),
    languageScore: Math.round(clamp(70 - fillerDensityPer100Words * 3)),
    artifacts: {
      fillerDensityPer100Words,
      topFillers,
      selfCorrections,
    },
    rubricChecks: checks,
    loChecks: [],
    grammarChecks: [],
    vocabChecks: [],
    evidence: [input.transcript.slice(0, 220)],
    modelVersion: MODEL_VERSION,
  };

  const feedback = buildFeedbackFromEvaluation(
    taskEvaluation,
    "This morning I woke up, ate breakfast, and got ready for school.",
    input.transcript
  );
  return { taskEvaluation, feedback };
}

function evaluateSpeechBuilder(input: EvaluationInput): { taskEvaluation: TaskEvaluation; feedback: FeedbackResult } {
  const sentences = splitSentences(input.transcript);
  const text = input.transcript.toLowerCase();
  const hookPresent = /\?|!|\b(imagine|did you know|today)\b/.test(sentences[0] || "");
  const pointPresent = /\b(i think|my point|important)\b/.test(text);
  const examplePresent = /\b(for example|for instance|when i|once)\b/.test(text);
  const closePresent = /\b(thank you|in conclusion|that is why|so)\b/.test(text);
  const orderQuality = sentences.length >= 4 ? 80 : 45;
  const requiredParts = Array.isArray(input.taskMeta?.requiredParts)
    ? input.taskMeta.requiredParts.map((value) => String(value))
    : ["hook", "point", "example", "close"];
  const parts = {
    hook: hookPresent,
    point: pointPresent,
    example: examplePresent,
    close: closePresent,
  };
  const presentCount = requiredParts.filter((part) => parts[part as keyof typeof parts]).length;

  const checks: RubricCheck[] = [
    {
      name: "parts_present",
      pass: presentCount >= Math.max(3, requiredParts.length - 1),
      reason:
        presentCount >= Math.max(3, requiredParts.length - 1)
          ? "You included most speech parts."
          : "Include all 4 parts: start, main idea, example, and ending.",
      weight: 0.7,
    },
    {
      name: "order_quality",
      pass: orderQuality >= 70,
      reason: orderQuality >= 70 ? "Your structure is mostly in order." : "Follow the expected order more clearly.",
      weight: 0.3,
    },
  ];

  const taskEvaluation: TaskEvaluation = {
    taskType: input.taskType,
    taskScore: scoreFromChecks(checks),
    languageScore: Math.round(clamp(55 + presentCount * 10)),
    artifacts: {
      hookPresent,
      pointPresent,
      examplePresent,
      closePresent,
      orderQuality,
    },
    rubricChecks: checks,
    loChecks: [],
    grammarChecks: [],
    vocabChecks: [],
    evidence: sentences.slice(0, 4),
    modelVersion: MODEL_VERSION,
  };

  const feedback = buildFeedbackFromEvaluation(
    taskEvaluation,
    "Did you know reading every day can change your life? My point is simple: reading builds knowledge.",
    input.transcript
  );
  return { taskEvaluation, feedback };
}

function selectExampleBetterAnswer(
  taskEvaluation: TaskEvaluation,
  transcript: string,
  candidate: string
) {
  const failedCount = taskEvaluation.rubricChecks.filter((check) => !check.pass).length;
  const hasStrongAnswer = taskEvaluation.taskScore >= 85 && failedCount === 0;
  if (hasStrongAnswer) return "";
  if (!candidate || candidate.trim().length < 20) return "";
  if (candidate.trim().toLowerCase() === transcript.trim().toLowerCase()) return "";
  return candidate;
}

function evaluateDeterministic(input: EvaluationInput) {
  switch (input.taskType) {
    case "read_aloud":
      return evaluateReadAloud(input);
    case "target_vocab":
      return evaluateTargetVocab(input);
    case "role_play":
      return evaluateRolePlay(input);
    case "qa_prompt":
      return evaluateQAPrompt(input);
    case "filler_control":
      return evaluateFillerControl(input);
    case "speech_builder":
      return evaluateSpeechBuilder(input);
    case "topic_talk":
    default:
      return evaluateTopicTalk(input);
  }
}

function buildTaskSpecificPrompt(taskType: string) {
  const rubricMap: Record<string, string> = {
    read_aloud:
      "Artifacts required: referenceCoverage, omittedWords, insertedWords, mispronouncedHotspots.",
    topic_talk:
      "Artifacts required: mainPointDetected, supportingDetailCount, offTopicRatio, coherenceSignals.",
    qa_prompt:
      "Artifacts required: questionAnswered, directAnswerFirst, supportingReasons, irrelevantSegments.",
    role_play:
      "Artifacts required: requiredActsCompleted, turnSimulationQuality, politenessMarkers.",
    target_vocab:
      "Artifacts required: requiredWordsUsed, wordUsageCorrectness, inflectedFormsAccepted, missingWords.",
    filler_control:
      "Artifacts required: fillerDensityPer100Words, topFillers, selfCorrections.",
    speech_builder:
      "Artifacts required: startPresent, mainIdeaPresent, examplePresent, endingPresent, orderQuality.",
  };
  return rubricMap[taskType] || rubricMap.topic_talk;
}

function buildOpenAIInput(input: EvaluationInput) {
  const limits = getEvaluationLimits(input.taskMeta);
  const transcript = (input.transcript || "").slice(0, limits.TRANSCRIPT_MAX_CHARS);
  const taskPrompt = (input.taskPrompt || "").slice(0, 260);
  const taskMeta = input.taskMeta || {};
  const referenceText = typeof taskMeta.referenceText === "string" ? taskMeta.referenceText.slice(0, 260) : undefined;
  const requiredWords = resolveRequiredWords(input).slice(0, 20);
  return {
    taskType: input.taskType,
    taskPrompt,
    transcript,
    constraints: input.constraints || null,
    taskMeta: {
      referenceText,
      requiredWords,
      supportsPronAssessment: Boolean(taskMeta.supportsPronAssessment),
    },
    speechMetrics: {
      durationSec: input.speechMetrics.durationSec,
      wordCount: input.speechMetrics.wordCount,
      speechRate: input.speechMetrics.speechRate,
      fillerCount: input.speechMetrics.fillerCount,
      pauseCount: input.speechMetrics.pauseCount,
      confidence: input.speechMetrics.confidence,
      fluency: input.speechMetrics.fluency,
      pronunciation: input.speechMetrics.pronunciation,
      accuracy: input.speechMetrics.accuracy,
      completeness: input.speechMetrics.completeness,
      prosody: input.speechMetrics.prosody,
    },
  };
}

function parseMaybeJson(content: string) {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced && fenced[1]) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch {
        return null;
      }
    }
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

const loOnlySchema = z.object({
  loChecks: z.array(
    z.object({
      checkId: z.string(),
      label: z.string(),
      pass: z.boolean(),
      confidence: z.number().min(0).max(1),
      severity: z.enum(["low", "medium", "high"]),
      evidenceSpan: z.string().optional(),
    })
  ),
});

const grammarOnlySchema = z.object({
  grammarChecks: z.array(
    z.object({
      checkId: z.string().optional(),
      descriptorId: z.string().optional(),
      label: z.string(),
      pass: z.boolean(),
      confidence: z.number().min(0).max(1),
      opportunityType: z.enum(["explicit_target", "elicited_incidental", "incidental"]),
      errorType: z.string().optional(),
      evidenceSpan: z.string().optional(),
      correction: z.string().optional(),
    })
  ),
});

const vocabOnlySchema = z.object({
  vocabChecks: z.array(
    z.object({
      nodeId: z.string(),
      label: z.string(),
      pass: z.boolean(),
      confidence: z.number().min(0).max(1),
      opportunityType: z.enum(["explicit_target", "incidental"]),
      evidenceSpan: z.string().optional(),
      matchedPhrase: z.string().optional(),
    })
  ),
});

const toStrArray = (v: unknown, maxLen: number): string[] => {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean).slice(0, maxLen);
  if (typeof v === "string" && v.trim()) return [v.trim()];
  return [];
};

const generalOnlySchema = z.object({
  taskEvaluation: z.object({
    taskType: z.string(),
    taskScore: z.number().min(0).max(100),
    languageScore: z.number().min(0).max(100).optional(),
    artifacts: z.record(z.unknown()),
    rubricChecks: z.array(
      z.object({
        name: z.string(),
        pass: z.boolean(),
        reason: z.string(),
        weight: z.number().min(0).max(1),
      })
    ),
    evidence: z.preprocess((v) => (v == null ? [] : toStrArray(v, 6)), z.array(z.string()).max(6)),
  }),
  feedback: z.object({
    summary: z.string(),
    whatWentWell: z.preprocess(
      (v) => (toStrArray(v, 3).length ? toStrArray(v, 3) : ["Good effort."]),
      z.array(z.string()).min(1).max(3)
    ),
    whatToFixNow: z.preprocess(
      (v) => (toStrArray(v, 3).length ? toStrArray(v, 3) : ["Keep practicing."]),
      z.array(z.string()).min(1).max(3)
    ),
    exampleBetterAnswer: z.string(),
    nextMicroTask: z.string(),
  }),
});

async function evaluateLoOnly(
  apiKey: string,
  model: string,
  input: EvaluationInput,
  targetOptions: Array<{ nodeId: string; label: string }>,
  candidateOptions: Array<{ nodeId: string; label: string }>
): Promise<LoCheck[]> {
  const limits = getEvaluationLimits(input.taskMeta);
  const compactInput = buildOpenAIInput(input);
  const prompt = [
    "You evaluate ONLY Learning Objectives (LO) for this child speaking attempt.",
    "Return one JSON object: { \"loChecks\": [ ... ] }. No markdown.",
    "Use only nodeIds from the provided options. Do not invent IDs.",
    "Evidence gating: set pass=true ONLY if the transcript contains clear evidence for that LO. Include ALL target options (pass true/false).",
    "For candidate (incidental) options: include a check ONLY when the transcript shows this LO was used or attempted. Omit if the LO did not appear in the speech.",
    "Include up to " + limits.SPLIT_LO_CHECKS_MAX + " loChecks when evidenced.",
    "Each item: { checkId (nodeId), label, pass, confidence (0..1), severity (low|medium|high), evidenceSpan (optional) }.",
    `Target LO options: ${JSON.stringify(targetOptions)}`,
    `Candidate LO options: ${JSON.stringify(candidateOptions)}`,
    `Input: ${JSON.stringify(compactInput)}`,
  ].join("\n");
  const content = await chatJson(
    "You are a strict speaking evaluator. Output one JSON object only. No markdown.",
    prompt,
    { openaiApiKey: apiKey, model, temperature: 0, maxTokens: limits.TOKEN_BUDGET_LO, runName: "gse_eval_lo", tags: ["gse", "eval_split", "lo"] }
  );
  const raw = parseMaybeJson(content || "");
  if (!raw || typeof raw !== "object") return [];
  const parsed = loOnlySchema.safeParse(raw);
  if (!parsed.success) {
    console.log(
      JSON.stringify({
        event: "eval_lo_parse_fail",
        reason: parsed.error.message.slice(0, 200),
        responsePreview: (typeof content === "string" ? content : "").slice(-400),
      })
    );
    return [];
  }
  return (parsed.data.loChecks || []).slice(0, limits.SPLIT_LO_CHECKS_MAX);
}

async function evaluateGrammarOnly(
  apiKey: string,
  model: string,
  input: EvaluationInput,
  targetOptions: Array<{ descriptorId: string; label: string }>,
  candidateOptions: Array<{ descriptorId: string; label: string }>,
  targetGrammarDescriptorIds: Set<string>
): Promise<GrammarCheck[]> {
  const limits = getEvaluationLimits(input.taskMeta);
  const compactInput = buildOpenAIInput(input);
  const prompt = [
    "You evaluate ONLY Grammar for this child speaking attempt.",
    "Return one JSON object: { \"grammarChecks\": [ ... ] }. No markdown.",
    "Use only descriptorIds from the provided options. Do not invent IDs.",
    "Evidence gating: set pass=true ONLY if the transcript contains clear evidence. Include ALL target options (pass true/false).",
    "For candidate options: include a check ONLY when the construct appears in the transcript (correct or incorrect use). Omit if not used.",
    "opportunityType: explicit_target ONLY for descriptorIds in Target Grammar options; otherwise incidental or elicited_incidental.",
    "Include up to " + limits.SPLIT_GRAMMAR_CHECKS_MAX + " grammarChecks when evidenced.",
    "Each item: { checkId, descriptorId, label, pass, confidence (0..1), opportunityType, evidenceSpan (optional) }.",
    `Target Grammar options: ${JSON.stringify(targetOptions)}`,
    `Candidate Grammar options: ${JSON.stringify(candidateOptions)}`,
    `Input: ${JSON.stringify(compactInput)}`,
  ].join("\n");
  const content = await chatJson(
    "You are a strict speaking evaluator. Output one JSON object only. No markdown.",
    prompt,
    {
      openaiApiKey: apiKey,
      model,
      temperature: 0,
      maxTokens: limits.TOKEN_BUDGET_GRAMMAR,
      runName: "gse_eval_grammar",
      tags: ["gse", "eval_split", "grammar"],
    }
  );
  const raw = parseMaybeJson(content || "");
  if (!raw || typeof raw !== "object") return [];
  const parsed = grammarOnlySchema.safeParse(raw);
  if (!parsed.success) {
    console.log(
      JSON.stringify({
        event: "eval_grammar_parse_fail",
        reason: parsed.error.message.slice(0, 200),
        responsePreview: (typeof content === "string" ? content : "").slice(-400),
      })
    );
    return [];
  }
  return (parsed.data.grammarChecks || []).slice(0, limits.SPLIT_GRAMMAR_CHECKS_MAX).map((c) => ({
    ...c,
    checkId: c.checkId ?? c.descriptorId ?? slugify(c.label),
    opportunityType:
      c.descriptorId && targetGrammarDescriptorIds.has(c.descriptorId)
        ? "explicit_target"
        : c.opportunityType,
  }));
}

async function evaluateVocabOnly(
  apiKey: string,
  model: string,
  input: EvaluationInput,
  targetOptions: Array<{ nodeId: string; label: string }>,
  candidateOptions: Array<{ nodeId: string; label: string; topicHints?: string[]; grammaticalCategories?: string[] }>,
  targetVocabNodeIds: Set<string>
): Promise<VocabCheck[]> {
  const limits = getEvaluationLimits(input.taskMeta);
  const compactInput = buildOpenAIInput(input);
  const prompt = [
    "You evaluate ONLY Vocabulary for this child speaking attempt.",
    "Return one JSON object: { \"vocabChecks\": [ ... ] }. No markdown.",
    "Use only nodeIds from the provided options. Do not invent IDs.",
    "Evidence gating: set pass=true ONLY if the transcript contains clear evidence. Include ALL target options (pass true/false).",
    "For candidate options: include a check ONLY when the word or phrase appears in the transcript (correct or incorrect use). Omit if not used.",
    "opportunityType: explicit_target ONLY for nodeIds in Target Vocabulary options; otherwise incidental.",
    "Include up to " + limits.SPLIT_VOCAB_CHECKS_MAX + " vocabChecks when evidenced.",
    "Each item: { nodeId, label, pass, confidence (0..1), opportunityType, evidenceSpan (optional), matchedPhrase (optional) }.",
    `Target Vocabulary options: ${JSON.stringify(targetOptions)}`,
    `Candidate Vocabulary options: ${JSON.stringify(candidateOptions.map((c) => ({ nodeId: c.nodeId, label: c.label })))}`,
    `Input: ${JSON.stringify(compactInput)}`,
  ].join("\n");
  const content = await chatJson(
    "You are a strict speaking evaluator. Output one JSON object only. No markdown.",
    prompt,
    {
      openaiApiKey: apiKey,
      model,
      temperature: 0,
      maxTokens: limits.TOKEN_BUDGET_VOCAB,
      runName: "gse_eval_vocab",
      tags: ["gse", "eval_split", "vocab"],
    }
  );
  const raw = parseMaybeJson(content || "");
  if (!raw || typeof raw !== "object") return [];
  const parsed = vocabOnlySchema.safeParse(raw);
  if (!parsed.success) {
    console.log(
      JSON.stringify({
        event: "eval_vocab_parse_fail",
        reason: parsed.error.message.slice(0, 200),
        responsePreview: (typeof content === "string" ? content : "").slice(-400),
      })
    );
    return [];
  }
  return (parsed.data.vocabChecks || []).slice(0, limits.SPLIT_VOCAB_CHECKS_MAX).map((c) => ({
    ...c,
    opportunityType: c.nodeId && targetVocabNodeIds.has(c.nodeId) ? "explicit_target" : c.opportunityType,
  }));
}

async function evaluateGeneralOnly(
  apiKey: string,
  model: string,
  input: EvaluationInput,
  domainSummary: { loPass: number; grammarPass: number; vocabPass: number }
): Promise<{
  taskScore: number;
  languageScore?: number;
  rubricChecks: RubricCheck[];
  artifacts: Record<string, unknown>;
  evidence: string[];
  feedback: FeedbackResult;
} | null> {
  const compactInput = buildOpenAIInput(input);
  const prompt = [
    "Evaluate overall task success and give feedback for this child speaking attempt. Do NOT evaluate LO/grammar/vocab — that is done separately.",
    "Return one JSON object: { taskEvaluation: { taskType, taskScore, languageScore, artifacts, rubricChecks, evidence }, feedback: { summary, whatWentWell, whatToFixNow, exampleBetterAnswer, nextMicroTask } }.",
    "Scores 0..100. rubricChecks: at least 2 items, each { name, pass, reason, weight }. Total weight close to 1.",
    buildTaskSpecificPrompt(input.taskType),
    "Domain checks summary (for consistency): " + JSON.stringify(domainSummary),
    `Input: ${JSON.stringify(compactInput)}`,
  ].join("\n");
  const content = await chatJson(
    "You are a strict speaking evaluator. Output one JSON object only. No markdown.",
    prompt,
    {
      openaiApiKey: apiKey,
      model,
      temperature: 0,
      maxTokens: 850,
      runName: "gse_eval_general",
      tags: ["gse", "eval_split", "general"],
    }
  );
  const raw = parseMaybeJson(content || "");
  if (!raw || typeof raw !== "object") return null;
  const parsed = generalOnlySchema.safeParse(raw);
  if (!parsed.success) return null;
  const te = parsed.data.taskEvaluation;
  const fb = parsed.data.feedback;
  return {
    taskScore: te.taskScore,
    languageScore: te.languageScore,
    rubricChecks: te.rubricChecks?.length ? te.rubricChecks : [{ name: "task", pass: te.taskScore >= 65, reason: "Overall", weight: 1 }],
    artifacts: te.artifacts ?? {},
    evidence: te.evidence ?? [],
    feedback: fb,
  };
}

async function evaluateWithOpenAISplit(input: EvaluationInput): Promise<{
  parsed: { taskEvaluation: TaskEvaluation; feedback: FeedbackResult } | null;
  debug: Pick<EvaluationDebugInfo, "openai">;
}> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  if (!apiKey) {
    return {
      parsed: null,
      debug: {
        openai: {
          enabled: false,
          model: model ?? "gpt-4.1-mini",
          attempts: [],
          finalSource: "rules" as const,
          reason: "OPENAI_API_KEY is missing",
        },
      },
    };
  }

  const stageRaw =
    typeof input.taskMeta?.stage === "string" && input.taskMeta.stage.trim().length > 0
      ? input.taskMeta.stage
      : "A2";
  const ageBandRaw =
    typeof input.taskMeta?.ageBand === "string" && input.taskMeta.ageBand.trim().length > 0
      ? input.taskMeta.ageBand
      : null;

  const [semanticContext, vocabContext] = await Promise.all([
    buildSemanticEvaluationContext({
      transcript: input.transcript,
      taskPrompt: input.taskPrompt,
      taskType: input.taskType,
      stage: stageRaw,
      ageBand: ageBandRaw,
    }),
    buildVocabEvaluationContext({
      transcript: input.transcript,
      stage: stageRaw,
      ageBand: ageBandRaw,
      taskType: input.taskType,
      runId: input.taskId,
    }),
  ]);

  const taskTargets = Array.isArray(input.taskTargets) ? input.taskTargets : [];
  const targetLoOptions = taskTargets
    .filter((t) => t?.node?.type === "GSE_LO" && typeof t.nodeId === "string" && typeof t.node?.descriptor === "string")
    .slice(0, 8)
    .map((t) => ({ nodeId: t.nodeId!, label: (t.node!.descriptor ?? "").slice(0, 140) }));
  const targetGrammarOptions = taskTargets
    .filter(
      (t) =>
        t?.node?.type === "GSE_GRAMMAR" &&
        typeof t.node?.sourceKey === "string" &&
        typeof t.node?.descriptor === "string"
    )
    .slice(0, 8)
    .map((t) => ({
      descriptorId: t.node!.sourceKey,
      label: (t.node!.descriptor ?? "").slice(0, 140),
    }));
  const targetVocabOptions = taskTargets
    .filter((t) => t?.node?.type === "GSE_VOCAB" && typeof t.nodeId === "string" && typeof t.node?.descriptor === "string")
    .slice(0, 12)
    .map((t) => ({ nodeId: t.nodeId!, label: (t.node!.descriptor ?? "").slice(0, 140) }));

  const limits = getEvaluationLimits(input.taskMeta);
  const targetLoNodeIds = new Set(targetLoOptions.map((t) => t.nodeId));
  const targetGrammarDescriptorIds = new Set(targetGrammarOptions.map((t) => t.descriptorId));
  const targetVocabNodeIds = new Set(targetVocabOptions.map((t) => t.nodeId));

  const loOptions = semanticContext.loCandidates
    .filter((item) => !targetLoNodeIds.has(item.nodeId))
    .slice(0, limits.SPLIT_LO_CANDIDATES)
    .map((item) => ({ nodeId: item.nodeId, label: item.descriptor.slice(0, 140) }));
  const grammarOptions = semanticContext.grammarCandidates
    .filter((item) => !targetGrammarDescriptorIds.has(item.sourceKey))
    .slice(0, limits.SPLIT_GRAMMAR_CANDIDATES)
    .map((item) => ({ descriptorId: item.sourceKey, label: item.descriptor.slice(0, 140) }));
  const vocabOptions = vocabContext.candidates
    .filter((c) => !targetVocabNodeIds.has(c.nodeId))
    .slice(0, limits.SPLIT_VOCAB_CANDIDATES)
    .map((c) => ({
      nodeId: c.nodeId,
      label: c.descriptor.slice(0, 140),
      topicHints: c.topicHints?.slice(0, 2),
      grammaticalCategories: c.grammaticalCategories?.slice(0, 2),
    }));

  const [loChecks, grammarChecks, vocabChecks] = await Promise.all([
    evaluateLoOnly(apiKey, model, input, targetLoOptions, loOptions),
    evaluateGrammarOnly(
      apiKey,
      model,
      input,
      targetGrammarOptions,
      grammarOptions,
      targetGrammarDescriptorIds
    ),
    evaluateVocabOnly(apiKey, model, input, targetVocabOptions, vocabOptions, targetVocabNodeIds),
  ]);

  const domainSummary = {
    loPass: loChecks.filter((c) => c.pass).length,
    grammarPass: grammarChecks.filter((c) => c.pass).length,
    vocabPass: vocabChecks.filter((c) => c.pass).length,
  };

  const general = await evaluateGeneralOnly(apiKey, model, input, domainSummary);

  if (!general) {
    const fallback = evaluateDeterministic(input);
    const taskEvaluation: TaskEvaluation = {
      taskType: input.taskType,
      taskScore: fallback.taskEvaluation.taskScore,
      languageScore: fallback.taskEvaluation.languageScore,
      artifacts: fallback.taskEvaluation.artifacts,
      rubricChecks: fallback.taskEvaluation.rubricChecks,
      loChecks,
      grammarChecks,
      vocabChecks,
      evidence: fallback.taskEvaluation.evidence,
      modelVersion: `${MODEL_VERSION}+openai-split`,
    };
    console.log(
      JSON.stringify({
        event: "eval_general_parse_fail_merge_domain",
        taskType: input.taskType,
        loCount: loChecks.length,
        grammarCount: grammarChecks.length,
        vocabCount: vocabChecks.length,
      })
    );
    return {
      parsed: {
        taskEvaluation,
        feedback: fallback.feedback,
      },
      debug: {
        openai: {
          enabled: true,
          model,
          attempts: [{ try: 1, status: 200, ok: true, parseOk: true }],
          finalSource: "openai" as const,
        },
      },
    };
  }

  const taskEvaluation: TaskEvaluation = {
    taskType: input.taskType,
    taskScore: general.taskScore,
    languageScore: general.languageScore,
    artifacts: general.artifacts,
    rubricChecks: general.rubricChecks,
    loChecks,
    grammarChecks,
    vocabChecks,
    evidence: general.evidence,
    modelVersion: `${MODEL_VERSION}+openai-split`,
  };

  return {
    parsed: {
      taskEvaluation,
      feedback: general.feedback,
    },
    debug: {
      openai: {
        enabled: true,
        model,
        attempts: [{ try: 1, status: 200, ok: true, parseOk: true }],
        finalSource: "openai" as const,
      },
    },
  };
}

export async function evaluateTaskQuality(input: EvaluationInput) {
  const promptPreview = `${input.taskType} :: ${input.taskPrompt.slice(0, 160)}`;
  const fromModel = await evaluateWithOpenAISplit(input);
  if (fromModel.parsed) {
    const baseTaskEvaluation: TaskEvaluation = {
      ...fromModel.parsed.taskEvaluation,
      modelVersion: fromModel.parsed.taskEvaluation.modelVersion || `${MODEL_VERSION}+openai`,
      loChecks: fromModel.parsed.taskEvaluation.loChecks || [],
      grammarChecks: fromModel.parsed.taskEvaluation.grammarChecks || [],
      vocabChecks: fromModel.parsed.taskEvaluation.vocabChecks || [],
    };
    const modelTaskEvaluation = attachStructuredChecks(baseTaskEvaluation, input.transcript);
    const normalizedFeedback = {
      ...fromModel.parsed.feedback,
      exampleBetterAnswer: selectExampleBetterAnswer(
        modelTaskEvaluation,
        input.transcript,
        fromModel.parsed.feedback.exampleBetterAnswer
      ),
    };
    return {
      taskEvaluation: modelTaskEvaluation,
      feedback: normalizedFeedback,
      source: "openai" as const,
      debug: {
        ...fromModel.debug,
        promptPreview,
      },
    };
  }

  const fallback = evaluateDeterministic(input);
  const normalizedFallback = {
    taskEvaluation: attachStructuredChecks(fallback.taskEvaluation, input.transcript),
    feedback: fallback.feedback,
  };
  console.log(JSON.stringify({ event: "fallback_used", taskType: input.taskType, reason: fromModel.debug.openai.reason }));
  return {
    ...normalizedFallback,
    source: "rules" as const,
    debug: {
      ...fromModel.debug,
      promptPreview,
    },
  };
}

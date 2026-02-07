import { z } from "zod";
import { SpeechMetrics } from "./scoring";
import { extractReferenceText, extractRequiredWords } from "./taskText";
import { chatJson } from "./llm";
import { buildSemanticEvaluationContext } from "./gse/semanticAssessor";
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

export type TaskEvaluation = {
  taskType: string;
  taskScore: number;
  languageScore?: number;
  artifacts: Record<string, unknown>;
  rubricChecks: RubricCheck[];
  loChecks: LoCheck[];
  grammarChecks: GrammarCheck[];
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

const outputSchema = z.object({
  taskEvaluation: z.object({
    taskType: z.string(),
    taskScore: z.preprocess((value) => {
      if (typeof value === "string") {
        const v = value.trim().toLowerCase();
        if (v === "pass") return 78;
        if (v === "fail") return 35;
        const n = Number(value);
        if (Number.isFinite(n)) return n;
      }
      return value;
    }, z.number().min(0).max(100)),
    languageScore: z.preprocess((value) => {
      if (value === undefined || value === null || value === "") return undefined;
      if (typeof value === "string") {
        const n = Number(value);
        if (Number.isFinite(n)) return n;
      }
      return value;
    }, z.number().min(0).max(100).optional()),
    artifacts: z.record(z.unknown()),
    rubricChecks: z.array(
      z.object({
        name: z.string(),
        pass: z.boolean(),
        reason: z.string(),
        weight: z.number().min(0).max(1),
      })
    ),
    loChecks: z
      .array(
        z.object({
          checkId: z.string(),
          label: z.string(),
          pass: z.boolean(),
          confidence: z.number().min(0).max(1),
          severity: z.enum(["low", "medium", "high"]),
          evidenceSpan: z.string().optional(),
        })
      )
      .optional(),
    grammarChecks: z
      .array(
        z.object({
          checkId: z.string(),
          descriptorId: z.string().optional(),
          label: z.string(),
          pass: z.boolean(),
          confidence: z.number().min(0).max(1),
          opportunityType: z.enum(["explicit_target", "elicited_incidental", "incidental"]),
          errorType: z.string().optional(),
          evidenceSpan: z.string().optional(),
          correction: z.string().optional(),
        })
      )
      .optional(),
    evidence: z.array(z.string()).max(6),
    modelVersion: z.string(),
  }),
  feedback: z.object({
    summary: z.string(),
    whatWentWell: z.array(z.string()).min(1).max(3),
    whatToFixNow: z.array(z.string()).min(1).max(3),
    exampleBetterAnswer: z.string(),
    nextMicroTask: z.string(),
  }),
});

function toNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "pass") return 78;
    if (v === "fail") return 35;
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

function toBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (v === "true" || v === "yes" || v === "pass") return true;
    if (v === "false" || v === "no" || v === "fail") return false;
  }
  return false;
}

function toConfidence(value: unknown, fallback = 0.72) {
  const n = toNumber(value);
  if (n === null) return fallback;
  if (n > 1) return Math.max(0, Math.min(1, n / 100));
  return Math.max(0, Math.min(1, n));
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

function toStringArray(value: unknown, fallback: string[] = []) {
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(/\n|,/)
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return fallback;
}

function normalizeModelPayload(payload: unknown, input: EvaluationInput) {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  const taskEvaluationRaw = (row.taskEvaluation || {}) as Record<string, unknown>;
  const feedbackRaw = (row.feedback || {}) as Record<string, unknown>;
  const normalized = {
    taskEvaluation: {
      taskType: String(taskEvaluationRaw.taskType || input.taskType),
      taskScore: toNumber(taskEvaluationRaw.taskScore),
      languageScore: toNumber(taskEvaluationRaw.languageScore) ?? undefined,
      artifacts:
        taskEvaluationRaw.artifacts && typeof taskEvaluationRaw.artifacts === "object"
          ? (taskEvaluationRaw.artifacts as Record<string, unknown>)
          : {},
      rubricChecks: Array.isArray(taskEvaluationRaw.rubricChecks)
        ? taskEvaluationRaw.rubricChecks.map((item) => {
            const rowItem = (item || {}) as Record<string, unknown>;
            return {
              name: String(rowItem.name || "check"),
              pass: toBoolean(rowItem.pass),
              reason: String(rowItem.reason || "No reason provided."),
              weight: Math.max(
                0,
                Math.min(1, toNumber(rowItem.weight) ?? 0.3)
              ),
            };
          })
        : [],
      loChecks: Array.isArray(taskEvaluationRaw.loChecks)
        ? taskEvaluationRaw.loChecks.map((item) => {
            const rowItem = (item || {}) as Record<string, unknown>;
            return {
              checkId: String(rowItem.checkId || slugify(String(rowItem.label || rowItem.name || "lo_check"))),
              label: String(rowItem.label || rowItem.name || "LO check"),
              pass: toBoolean(rowItem.pass),
              confidence: toConfidence(rowItem.confidence, 0.75),
              severity:
                rowItem.severity === "high" || rowItem.severity === "medium" || rowItem.severity === "low"
                  ? rowItem.severity
                  : "medium",
              evidenceSpan: rowItem.evidenceSpan ? String(rowItem.evidenceSpan) : undefined,
            };
          })
        : [],
      grammarChecks: Array.isArray(taskEvaluationRaw.grammarChecks)
        ? taskEvaluationRaw.grammarChecks.map((item) => {
            const rowItem = (item || {}) as Record<string, unknown>;
            return {
              checkId: String(rowItem.checkId || slugify(String(rowItem.label || "grammar_check"))),
              descriptorId: rowItem.descriptorId ? String(rowItem.descriptorId) : undefined,
              label: String(rowItem.label || "Grammar check"),
              pass: toBoolean(rowItem.pass),
              confidence: toConfidence(rowItem.confidence, 0.72),
              opportunityType:
                rowItem.opportunityType === "explicit_target" ||
                rowItem.opportunityType === "elicited_incidental" ||
                rowItem.opportunityType === "incidental"
                  ? rowItem.opportunityType
                  : "incidental",
              errorType: rowItem.errorType ? String(rowItem.errorType) : undefined,
              evidenceSpan: rowItem.evidenceSpan ? String(rowItem.evidenceSpan) : undefined,
              correction: rowItem.correction ? String(rowItem.correction) : undefined,
            };
          })
        : [],
      evidence: toStringArray(taskEvaluationRaw.evidence, [input.transcript.slice(0, 180)]).slice(0, 6),
      modelVersion: String(taskEvaluationRaw.modelVersion || `${MODEL_VERSION}+openai`),
    },
    feedback: {
      summary: String(feedbackRaw.summary || "Keep practicing with clear and complete answers."),
      whatWentWell: toStringArray(feedbackRaw.whatWentWell, ["You completed the task."]).slice(0, 3),
      whatToFixNow: toStringArray(feedbackRaw.whatToFixNow, ["Add one clearer supporting detail next time."]).slice(0, 3),
      exampleBetterAnswer: String(feedbackRaw.exampleBetterAnswer || ""),
      nextMicroTask: String(feedbackRaw.nextMicroTask || "Retry with one stronger detail."),
    },
  };
  if (typeof normalized.taskEvaluation.taskScore !== "number") return null;
  if (!normalized.taskEvaluation.rubricChecks.length) {
    normalized.taskEvaluation.rubricChecks = [
      {
        name: "task_alignment",
        pass: normalized.taskEvaluation.taskScore >= 65,
        reason: normalized.taskEvaluation.taskScore >= 65 ? "Task mostly completed." : "Task needs clearer completion.",
        weight: 1,
      },
    ];
  }
  return normalized;
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

function attachStructuredChecks(taskEvaluation: TaskEvaluation, transcript: string): TaskEvaluation {
  return {
    ...taskEvaluation,
    loChecks: deriveLoChecks(taskEvaluation, transcript),
    grammarChecks: deriveGrammarChecks(taskEvaluation),
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
  const transcript = (input.transcript || "").slice(0, 900);
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

async function evaluateWithOpenAI(input: EvaluationInput) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  if (!apiKey) {
    return {
      parsed: null,
      debug: {
        openai: {
          enabled: false,
          model,
          attempts: [],
          finalSource: "rules" as const,
          reason: "OPENAI_API_KEY is missing",
        },
      },
    };
  }

  const compactInput = buildOpenAIInput(input);
  const stageRaw =
    typeof input.taskMeta?.stage === "string" && input.taskMeta.stage.trim().length > 0
      ? input.taskMeta.stage
      : "A2";
  const ageBandRaw =
    typeof input.taskMeta?.ageBand === "string" && input.taskMeta.ageBand.trim().length > 0
      ? input.taskMeta.ageBand
      : null;
  const semanticContext = await buildSemanticEvaluationContext({
    transcript: input.transcript,
    taskPrompt: input.taskPrompt,
    taskType: input.taskType,
    stage: stageRaw,
    ageBand: ageBandRaw,
  });

  const taskTargets = Array.isArray(input.taskTargets) ? input.taskTargets : [];
  const targetLoOptions = taskTargets
    .filter((t) => t?.node?.type === "GSE_LO" && typeof t.nodeId === "string" && typeof t.node?.descriptor === "string")
    .slice(0, 6)
    .map((t) => ({ nodeId: t.nodeId, label: t.node.descriptor.slice(0, 140), required: Boolean(t.required) }));
  const targetGrammarOptions = taskTargets
    .filter(
      (t) =>
        t?.node?.type === "GSE_GRAMMAR" &&
        typeof t.node?.sourceKey === "string" &&
        typeof t.node?.descriptor === "string"
    )
    .slice(0, 6)
    .map((t) => ({
      descriptorId: t.node.sourceKey,
      label: t.node.descriptor.slice(0, 140),
      required: Boolean(t.required),
    }));
  const targetOtherNodes = taskTargets
    .filter((t) => t?.node?.type !== "GSE_LO" && t?.node?.type !== "GSE_GRAMMAR")
    .slice(0, 6)
    .map((t) => ({
      nodeId: String(t.nodeId || t.node?.nodeId || ""),
      type: String(t.node?.type || ""),
      label: String(t.node?.descriptor || "").slice(0, 140),
      required: Boolean((t as { required?: unknown }).required),
    }))
    .filter((t) => t.nodeId && t.type && t.label);
  const loOptions = semanticContext.loCandidates.slice(0, 6).map((item) => ({
    nodeId: item.nodeId,
    label: item.descriptor.slice(0, 140),
  }));
  const grammarOptions = semanticContext.grammarCandidates.slice(0, 8).map((item) => ({
    descriptorId: item.sourceKey,
    label: item.descriptor.slice(0, 140),
  }));
  const retrievalTracePayload = {
    stage: stageRaw,
    ageBand: ageBandRaw,
    disabledReason: semanticContext.disabledReason || null,
    loCandidateCount: loOptions.length,
    grammarCandidateCount: grammarOptions.length,
    loCandidates: loOptions,
    grammarCandidates: grammarOptions,
  };
  console.log(
    JSON.stringify({
      event: "semantic_retrieval_candidates",
      stage: stageRaw,
      ageBand: ageBandRaw,
      disabledReason: semanticContext.disabledReason || null,
      loCandidateCount: loOptions.length,
      grammarCandidateCount: grammarOptions.length,
      loTop: loOptions.slice(0, 3),
      grammarTop: grammarOptions.slice(0, 3),
    })
  );
  await appendPipelineDebugEvent({
    event: "evaluation_prompt_inputs",
    taskType: input.taskType,
    stage: stageRaw,
    ageBand: ageBandRaw,
    taskPromptPreview: previewText(input.taskPrompt, 260),
    transcriptPreview: previewText(input.transcript, 600),
    semanticRetrieval: retrievalTracePayload,
    taskTargets: {
      lo: targetLoOptions,
      grammar: targetGrammarOptions,
      other: targetOtherNodes,
    },
    compactInput,
  });
  const prompt = [
    "Evaluate this child speaking attempt.",
    "Return one JSON object only. No markdown.",
    "Use only provided speechMetrics and descriptor options.",
    "Use boolean for pass fields and numbers for score/weight/confidence.",
    "Scores must be 0..100 (not 0..10). Prefer integers.",
    "Do not invent IDs: loChecks.checkId must be nodeId from loDescriptorOptions; grammarChecks.descriptorId must be from grammarDescriptorOptions.",
    "If target descriptor options are provided, you MUST include checks for them (pass true/false).",
    "For target grammar checks, set opportunityType=explicit_target.",
    "Keep at most 4 loChecks and 6 grammarChecks total.",
    "rubricChecks must have at least 2 items; each weight is 0..1 and total weight should be close to 1.",
    "Output shape: {taskEvaluation:{taskType,taskScore,languageScore,artifacts,rubricChecks,loChecks,grammarChecks,evidence,modelVersion},feedback:{summary,whatWentWell,whatToFixNow,exampleBetterAnswer,nextMicroTask}}",
    buildTaskSpecificPrompt(input.taskType),
    `Semantic retrieval status: ${JSON.stringify({
      disabledReason: semanticContext.disabledReason || null,
      loCandidateCount: loOptions.length,
      grammarCandidateCount: grammarOptions.length,
    })}`,
    `Target LO descriptor options (nodeId + label): ${JSON.stringify(
      targetLoOptions.map(({ nodeId, label }) => ({ nodeId, label }))
    )}`,
    `Target Grammar descriptor options (descriptorId + label): ${JSON.stringify(
      targetGrammarOptions.map(({ descriptorId, label }) => ({ descriptorId, label }))
    )}`,
    `Other target nodes (not LO/grammar): ${JSON.stringify(targetOtherNodes)}`,
    `LO descriptor options (nodeId + label): ${JSON.stringify(loOptions)}`,
    `Grammar descriptor options (descriptorId + descriptor): ${JSON.stringify(grammarOptions)}`,
    `Input JSON: ${JSON.stringify(compactInput)}`,
  ].join("\n");
  const attempts: EvaluationDebugInfo["openai"]["attempts"] = [];

  const systemContent =
    "You are a strict speaking evaluator for children. Output one JSON object only. No markdown. No comments. No text outside JSON.";

  for (let i = 0; i < 2; i += 1) {
    let content: string;
    try {
      content = await chatJson(systemContent, prompt, {
        openaiApiKey: apiKey,
        model,
        temperature: 0,
        maxTokens: 700,
        runName: "gse_evaluation",
        tags: ["gse", "evaluation"],
        metadata: {
          pipeline: "evaluation",
          taskType: input.taskType,
          semanticRetrieval: retrievalTracePayload,
          taskTargets: {
            lo: targetLoOptions.map(({ nodeId }) => nodeId),
            grammar: targetGrammarOptions.map(({ descriptorId }) => descriptorId),
            other: targetOtherNodes.map(({ nodeId }) => nodeId),
          },
        },
      });
    } catch (err) {
      const status = (err as { status?: number }).status;
      attempts.push({
        try: i + 1,
        status: status ?? null,
        ok: false,
        parseOk: false,
      });
      continue;
    }
    if (!content || !content.trim()) {
      attempts.push({
        try: i + 1,
        status: 200,
        ok: true,
        parseOk: false,
      });
      continue;
    }
    try {
      const raw = parseMaybeJson(content);
      if (!raw) throw new Error("model content is not valid JSON");
      const normalized = normalizeModelPayload(raw, input);
      if (!normalized) throw new Error("normalized payload is invalid");
      const parsed = outputSchema.parse(normalized);
      await appendPipelineDebugEvent({
        event: "evaluation_model_output",
        taskType: input.taskType,
        model,
        try: i + 1,
        responsePreview: content.slice(0, 800),
        parsed: parsed.taskEvaluation,
      });
      attempts.push({
        try: i + 1,
        status: 200,
        ok: true,
        parseOk: true,
        responsePreview: content.slice(0, 500),
      });
      return {
        parsed,
        debug: {
          openai: {
            enabled: true,
            model,
            attempts,
            finalSource: "openai" as const,
          },
        },
      };
    } catch (error) {
      await appendPipelineDebugEvent({
        event: "evaluation_model_parse_fail",
        taskType: input.taskType,
        model,
        try: i + 1,
        errorMessage: error instanceof Error ? error.message.slice(0, 400) : String(error).slice(0, 400),
        responsePreview: content.slice(0, 800),
      });
      attempts.push({
        try: i + 1,
        status: 200,
        ok: true,
        parseOk: false,
        parseError: error instanceof Error ? error.message.slice(0, 200) : "JSON parse failed",
        responsePreview: content.slice(0, 500),
      });
      console.log(JSON.stringify({ event: "openai_schema_fail", try: i + 1 }));
    }
  }
  return {
    parsed: null,
    debug: {
      openai: {
        enabled: true,
        model,
        attempts,
        finalSource: "rules" as const,
        reason: "invalid or non-schema JSON from model",
      },
    },
  };
}

export async function evaluateTaskQuality(input: EvaluationInput) {
  const promptPreview = `${input.taskType} :: ${input.taskPrompt.slice(0, 160)}`;
  const fromModel = await evaluateWithOpenAI(input);
  if (fromModel.parsed) {
    const baseTaskEvaluation: TaskEvaluation = {
      ...fromModel.parsed.taskEvaluation,
      modelVersion: `${MODEL_VERSION}+openai`,
      loChecks: fromModel.parsed.taskEvaluation.loChecks || [],
      grammarChecks: fromModel.parsed.taskEvaluation.grammarChecks || [],
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

import { z } from "zod";
import { chatJson } from "@/lib/llm";
import { config } from "@/lib/config";
import type { RubricCheck } from "@/lib/evaluator";
import { extractListeningQuestion, extractListeningScript } from "@/lib/taskText";

export const LISTENING_ASSESSMENT_VERSION = "listening-assessment-v2" as const;

const LISTENING_TASK_TYPES = ["listening_comprehension"] as const;

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "was",
  "were",
  "what",
  "when",
  "where",
  "who",
  "why",
  "with",
]);

export type ListeningAssessmentInput = {
  taskType: string;
  taskPrompt: string;
  transcript: string;
  hiddenReference?: {
    script?: string | null;
    question?: string | null;
  } | null;
  taskMeta?: Record<string, unknown> | null;
};

export type ListeningAssessment = {
  version: typeof LISTENING_ASSESSMENT_VERSION;
  evaluationMode: "llm" | "fallback";
  sourceReference: "task_meta" | "prompt_parse";
  script: string;
  question: string;
  scores: {
    comprehension: number;
    sourceGrounding: number;
    repairBehavior: number;
    overall: number;
  };
  signals: {
    scriptTokenCount: number;
    answerTokenCount: number;
    questionTokenCount: number;
    overlappingScriptTokens: string[];
    overlappingQuestionTokens: string[];
    repairCueCount: number;
    clarificationQuestionCount: number;
    evidenceSpans: string[];
    antiLeakPenalty: number;
  };
  rubricChecks: RubricCheck[];
  feedback: {
    summary: string;
    whatWentWell: string[];
    whatToFixNow: string[];
    exampleBetterAnswer: string;
    nextMicroTask: string;
  };
};

type ResolvedListeningReference = {
  script: string;
  question: string;
  sourceReference: "task_meta" | "prompt_parse";
};

const llmListeningSchema = z.object({
  scores: z.object({
    comprehension: z.number().min(0).max(100),
    sourceGrounding: z.number().min(0).max(100),
    repairBehavior: z.number().min(0).max(100),
    overall: z.number().min(0).max(100).optional(),
  }),
  rubricChecks: z
    .array(
      z.object({
        name: z.string(),
        pass: z.boolean(),
        reason: z.string(),
        weight: z.number().min(0).max(1),
      }),
    )
    .min(1)
    .max(6),
  feedback: z.object({
    summary: z.string().min(3),
    whatWentWell: z.array(z.string()).min(1).max(3),
    whatToFixNow: z.array(z.string()).min(1).max(3),
    exampleBetterAnswer: z.string().min(8),
    nextMicroTask: z.string().min(3),
  }),
  evidenceSpans: z.array(z.string()).max(4).optional(),
  groundingTokens: z.array(z.string()).max(12).optional(),
  questionTokens: z.array(z.string()).max(8).optional(),
});

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number) {
  return Number(value.toFixed(2));
}

function normalizeToken(raw: string) {
  const token = raw.trim().toLowerCase();
  if (token.length <= 3) return token;

  if (token.endsWith("ies") && token.length > 4) {
    return `${token.slice(0, -3)}y`;
  }
  if (token.endsWith("ing") && token.length > 5) {
    return token.slice(0, -3);
  }
  if (token.endsWith("ed") && token.length > 4) {
    return token.slice(0, -2);
  }
  if (token.endsWith("es") && token.length > 4) {
    return token.slice(0, -2);
  }
  if (token.endsWith("s") && token.length > 4) {
    return token.slice(0, -1);
  }

  return token;
}

function normalizeTokens(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .map((token) => normalizeToken(token))
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

function overlap(left: string[], right: string[]) {
  const rightSet = new Set(right);
  const shared = unique(left.filter((token) => rightSet.has(token)));
  const ratio = left.length > 0 ? shared.length / left.length : 0;
  return {
    shared,
    ratio,
  };
}

function extractEvidenceSpans(text: string) {
  return text
    .split(/[.!?]+/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length >= 10)
    .slice(0, 4);
}

function buildExampleAnswer(params: {
  question: string;
  scriptTokens: string[];
  overlapTokens: string[];
}) {
  const supportTokens = unique([...params.overlapTokens, ...params.scriptTokens]).slice(0, 4);
  const support = supportTokens.length > 0 ? supportTokens.join(", ") : "details from the audio";
  const starter = params.question ? `For the question (${params.question})` : "For this listening question";
  return `${starter}, I answer directly, mention details from the audio (${support}), and ask for clarification if needed.`;
}

function parseMaybeJson(content: string) {
  const trimmed = content.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      try {
        return JSON.parse(fenced[1].trim());
      } catch {
        return null;
      }
    }
    return null;
  }
}

function resolveHiddenReference(input: ListeningAssessmentInput): ResolvedListeningReference {
  const taskMeta = asObject(input.taskMeta);
  const hiddenRef = asObject(input.hiddenReference);
  const scriptFromMeta =
    asString(hiddenRef.script) ||
    asString(taskMeta.listeningScript) ||
    asString(extractListeningScript(input.taskPrompt)) ||
    "";
  const questionFromMeta =
    asString(hiddenRef.question) ||
    asString(taskMeta.listeningQuestion) ||
    asString(extractListeningQuestion(input.taskPrompt)) ||
    "What is the most important detail in the audio?";

  const sourceReference =
    asString(hiddenRef.script) || asString(taskMeta.listeningScript)
      ? "task_meta"
      : "prompt_parse";

  return {
    script: scriptFromMeta,
    question: questionFromMeta,
    sourceReference,
  };
}

function evaluateListeningFallback(params: {
  transcript: string;
  script: string;
  question: string;
  sourceReference: "task_meta" | "prompt_parse";
}): ListeningAssessment {
  const answer = params.transcript.trim();
  const scriptTokens = normalizeTokens(params.script);
  const questionTokens = normalizeTokens(params.question);
  const answerTokens = normalizeTokens(answer);

  const scriptOverlap = overlap(scriptTokens, answerTokens);
  const questionOverlap = overlap(questionTokens, answerTokens);
  const questionTokenSet = new Set(questionTokens);
  const scriptSpecificTokens = scriptTokens.filter((token) => !questionTokenSet.has(token));
  const scriptSpecificOverlap = overlap(scriptSpecificTokens, answerTokens);

  const repairCueCount = (
    answer.match(
      /\b(sorry|i mean|to clarify|let me rephrase|in other words|do you mean|can you repeat|did you say)\b/gi,
    ) || []
  ).length;
  const clarificationQuestionCount = (answer.match(/\?/g) || []).length;
  const answerLengthScore = clamp((answerTokens.length / 32) * 100);
  const connectorBoost = /(because|so|therefore|then|finally|for example)/i.test(answer) ? 8 : 0;

  const questionTokenRatio = questionOverlap.ratio;
  const scriptTokenRatio = scriptOverlap.ratio;
  const specificScriptRatio = scriptSpecificOverlap.ratio;
  const copyQuestionPenalty =
    questionTokenRatio >= 0.65 && specificScriptRatio < 0.18 ? 28 : 0;
  const lowGroundingPenalty =
    (scriptTokenRatio < 0.12 || specificScriptRatio < 0.12) && answerTokens.length >= 8 ? 12 : 0;
  const antiLeakPenalty = copyQuestionPenalty + lowGroundingPenalty;

  const comprehension = clamp(
    questionOverlap.ratio * 35 +
      scriptOverlap.ratio * 45 +
      answerLengthScore * 0.2 +
      connectorBoost -
      antiLeakPenalty,
  );
  const sourceGrounding = clamp(scriptOverlap.ratio * 100 - antiLeakPenalty * 0.5);
  const repairBehavior = clamp(
    30 + Math.min(45, repairCueCount * 18) + Math.min(25, clarificationQuestionCount * 12),
  );
  const overall = round(comprehension * 0.5 + sourceGrounding * 0.35 + repairBehavior * 0.15);

  const checks: RubricCheck[] = [
    {
      name: "listening_comprehension",
      pass: comprehension >= 55,
      reason:
        comprehension >= 55
          ? "Response answers the listening question clearly."
          : "Answer the listening question more directly.",
      weight: 0.4,
    },
    {
      name: "listening_source_grounding",
      pass: sourceGrounding >= 50,
      reason:
        sourceGrounding >= 50
          ? "Response uses details from the audio."
          : "Use more concrete details from what you heard.",
      weight: 0.4,
    },
    {
      name: "listening_repair_behavior",
      pass: repairBehavior >= 45,
      reason:
        repairBehavior >= 45
          ? "Repair or clarification language is present."
          : "Add a repair or clarification phrase when meaning is uncertain.",
      weight: 0.2,
    },
  ];

  const passedReasons = checks.filter((item) => item.pass).map((item) => item.reason);
  const failedReasons = checks.filter((item) => !item.pass).map((item) => item.reason);

  return {
    version: LISTENING_ASSESSMENT_VERSION,
    evaluationMode: "fallback",
    sourceReference: params.sourceReference,
    script: params.script,
    question: params.question,
    scores: {
      comprehension: round(comprehension),
      sourceGrounding: round(sourceGrounding),
      repairBehavior: round(repairBehavior),
      overall,
    },
    signals: {
      scriptTokenCount: scriptTokens.length,
      answerTokenCount: answerTokens.length,
      questionTokenCount: questionTokens.length,
      overlappingScriptTokens: scriptOverlap.shared.slice(0, 12),
      overlappingQuestionTokens: questionOverlap.shared.slice(0, 8),
      repairCueCount,
      clarificationQuestionCount,
      evidenceSpans: extractEvidenceSpans(answer),
      antiLeakPenalty,
    },
    rubricChecks: checks,
    feedback: {
      summary:
        overall >= 75
          ? "Strong listening response with grounded details."
          : "Good start. Add more details from what you heard.",
      whatWentWell:
        passedReasons.length > 0 ? passedReasons.slice(0, 3) : ["You completed the listening response."],
      whatToFixNow:
        failedReasons.length > 0
          ? failedReasons.slice(0, 3)
          : ["Keep grounding your answer in details from the audio."],
      exampleBetterAnswer: buildExampleAnswer({
        question: params.question,
        scriptTokens,
        overlapTokens: scriptOverlap.shared,
      }),
      nextMicroTask: "Replay the audio once and answer again with 2 concrete details.",
    },
  };
}

async function evaluateListeningWithLlm(params: {
  script: string;
  question: string;
  transcript: string;
}) {
  const apiKey = config.openai.apiKey;
  if (!apiKey) return null;

  const prompt = [
    "You are a strict listening comprehension evaluator for children.",
    "The learner only sees the question and hears audio. Evaluate by hidden audio reference, not by prompt overlap.",
    "Return one JSON object only, no markdown.",
    "JSON schema:",
    JSON.stringify({
      scores: {
        comprehension: "0..100",
        sourceGrounding: "0..100",
        repairBehavior: "0..100",
        overall: "0..100",
      },
      rubricChecks: [{ name: "string", pass: true, reason: "string", weight: 0.4 }],
      feedback: {
        summary: "string",
        whatWentWell: ["string"],
        whatToFixNow: ["string"],
        exampleBetterAnswer: "string",
        nextMicroTask: "string",
      },
      evidenceSpans: ["string"],
      groundingTokens: ["string"],
      questionTokens: ["string"],
    }),
    `Hidden audio reference script: ${params.script}`,
    `Listening question: ${params.question}`,
    `Learner answer transcript: ${params.transcript}`,
    "If learner answer is mostly keyword stuffing or question repetition without evidence from script, lower comprehension/sourceGrounding.",
  ].join("\n");

  try {
    const raw = await chatJson(
      "Output one JSON object only. No markdown.",
      prompt,
      {
        openaiApiKey: apiKey,
        model: config.openai.model,
        temperature: 0,
        maxTokens: 550,
        runName: "listening_assessment_v2",
        tags: ["listening", "assessment", "v2"],
      },
    );

    const parsed = parseMaybeJson(raw || "");
    if (!parsed || typeof parsed !== "object") return null;

    const safe = llmListeningSchema.safeParse(parsed);
    if (!safe.success) return null;
    return safe.data;
  } catch {
    return null;
  }
}

export function isListeningTaskType(taskType: string) {
  return LISTENING_TASK_TYPES.includes(taskType as (typeof LISTENING_TASK_TYPES)[number]);
}

export function evaluateListeningComprehensionFallback(input: ListeningAssessmentInput): ListeningAssessment {
  const reference = resolveHiddenReference(input);
  return evaluateListeningFallback({
    transcript: input.transcript,
    script: reference.script,
    question: reference.question,
    sourceReference: reference.sourceReference,
  });
}

export async function evaluateListeningComprehension(
  input: ListeningAssessmentInput,
): Promise<ListeningAssessment> {
  const reference = resolveHiddenReference(input);
  const fallback = evaluateListeningFallback({
    transcript: input.transcript,
    script: reference.script,
    question: reference.question,
    sourceReference: reference.sourceReference,
  });

  const llm = await evaluateListeningWithLlm({
    script: reference.script,
    question: reference.question,
    transcript: input.transcript,
  });

  if (!llm) return fallback;

  const questionTokens = normalizeTokens(reference.question);
  const scriptTokens = normalizeTokens(reference.script);
  const overall =
    typeof llm.scores.overall === "number"
      ? clamp(llm.scores.overall)
      : clamp(
          llm.scores.comprehension * 0.5 +
            llm.scores.sourceGrounding * 0.35 +
            llm.scores.repairBehavior * 0.15,
        );

  return {
    version: LISTENING_ASSESSMENT_VERSION,
    evaluationMode: "llm",
    sourceReference: reference.sourceReference,
    script: reference.script,
    question: reference.question,
    scores: {
      comprehension: round(clamp(llm.scores.comprehension)),
      sourceGrounding: round(clamp(llm.scores.sourceGrounding)),
      repairBehavior: round(clamp(llm.scores.repairBehavior)),
      overall: round(overall),
    },
    signals: {
      scriptTokenCount: scriptTokens.length,
      answerTokenCount: normalizeTokens(input.transcript).length,
      questionTokenCount: questionTokens.length,
      overlappingScriptTokens: (llm.groundingTokens || []).slice(0, 12),
      overlappingQuestionTokens: (llm.questionTokens || []).slice(0, 8),
      repairCueCount: fallback.signals.repairCueCount,
      clarificationQuestionCount: fallback.signals.clarificationQuestionCount,
      evidenceSpans: (llm.evidenceSpans || fallback.signals.evidenceSpans).slice(0, 4),
      antiLeakPenalty: fallback.signals.antiLeakPenalty,
    },
    rubricChecks: llm.rubricChecks,
    feedback: llm.feedback,
  };
}

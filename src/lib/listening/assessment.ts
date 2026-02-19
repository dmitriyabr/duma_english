import type { RubricCheck } from "@/lib/evaluator";
import { extractListeningQuestion, extractListeningScript } from "@/lib/taskText";

export const LISTENING_ASSESSMENT_VERSION = "listening-assessment-v1" as const;

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
};

export type ListeningAssessment = {
  version: typeof LISTENING_ASSESSMENT_VERSION;
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

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number) {
  return Number(value.toFixed(2));
}

function normalizeTokens(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
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
    .slice(0, 3);
}

function buildExampleAnswer(params: {
  question: string;
  scriptTokens: string[];
  overlapTokens: string[];
}) {
  const supportTokens = unique([...params.overlapTokens, ...params.scriptTokens]).slice(0, 4);
  const support = supportTokens.length > 0 ? supportTokens.join(", ") : "the audio details";
  const starter = params.question ? `For the listening question (${params.question})` : "For the listening question";
  return `${starter}, I answer directly, mention details from the audio (${support}), and confirm understanding if anything is unclear.`;
}

export function isListeningTaskType(taskType: string) {
  return LISTENING_TASK_TYPES.includes(taskType as (typeof LISTENING_TASK_TYPES)[number]);
}

export function evaluateListeningComprehension(input: ListeningAssessmentInput): ListeningAssessment {
  const script = extractListeningScript(input.taskPrompt);
  const question = extractListeningQuestion(input.taskPrompt);
  const answer = (input.transcript || "").trim();

  const scriptTokens = normalizeTokens(script);
  const questionTokens = normalizeTokens(question);
  const answerTokens = normalizeTokens(answer);

  const scriptOverlap = overlap(scriptTokens, answerTokens);
  const questionOverlap = overlap(questionTokens, answerTokens);

  const repairCueCount = (
    answer.match(
      /\b(sorry|i mean|to clarify|let me rephrase|in other words|do you mean|can you repeat|did you say)\b/gi,
    ) || []
  ).length;
  const clarificationQuestionCount = (answer.match(/\?/g) || []).length;
  const answerLengthScore = clamp((answerTokens.length / 30) * 100);
  const connectorBoost = /(because|so|therefore|then|finally|for example)/i.test(answer) ? 10 : 0;

  const comprehension = clamp(questionOverlap.ratio * 68 + answerLengthScore * 0.27 + connectorBoost);
  const sourceGrounding = clamp(scriptOverlap.ratio * 100);
  const repairBehavior = clamp(
    35 + Math.min(45, repairCueCount * 18) + Math.min(20, clarificationQuestionCount * 10),
  );
  const overall = round(comprehension * 0.45 + sourceGrounding * 0.35 + repairBehavior * 0.2);

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
          ? "Response uses details from the audio/script."
          : "Use more concrete details from what you heard.",
      weight: 0.35,
    },
    {
      name: "listening_repair_behavior",
      pass: repairBehavior >= 50,
      reason:
        repairBehavior >= 50
          ? "Repair/clarification behavior is present."
          : "Add a repair or clarification phrase when meaning is uncertain.",
      weight: 0.25,
    },
  ];

  const passedReasons = checks.filter((item) => item.pass).map((item) => item.reason);
  const failedReasons = checks.filter((item) => !item.pass).map((item) => item.reason);

  return {
    version: LISTENING_ASSESSMENT_VERSION,
    script,
    question,
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
    },
    rubricChecks: checks,
    feedback: {
      summary:
        overall >= 75
          ? "Strong listening response with grounded details."
          : "Good start. Add more details from what you heard and show repair behavior.",
      whatWentWell:
        passedReasons.length > 0 ? passedReasons.slice(0, 3) : ["You completed the listening response."],
      whatToFixNow:
        failedReasons.length > 0
          ? failedReasons.slice(0, 3)
          : ["Keep grounding your answer in details from the audio."],
      exampleBetterAnswer: buildExampleAnswer({
        question,
        scriptTokens,
        overlapTokens: scriptOverlap.shared,
      }),
      nextMicroTask: "Replay the prompt once and answer again with 2 details and 1 clarification cue.",
    },
  };
}

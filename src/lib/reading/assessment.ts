import type { RubricCheck } from "@/lib/evaluator";
import { extractReadingPassage, extractReadingQuestion } from "@/lib/taskText";

export const READING_ASSESSMENT_VERSION = "reading-assessment-v1" as const;

const READING_TASK_TYPES = ["reading_comprehension"] as const;

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

export type ReadingAssessmentInput = {
  taskType: string;
  taskPrompt: string;
  transcript: string;
};

export type ReadingAssessment = {
  version: typeof READING_ASSESSMENT_VERSION;
  passage: string;
  question: string;
  scores: {
    questionAddressing: number;
    sourceGrounding: number;
    detailCoverage: number;
    overall: number;
  };
  signals: {
    passageTokenCount: number;
    answerTokenCount: number;
    questionTokenCount: number;
    overlappingPassageTokens: string[];
    overlappingQuestionTokens: string[];
    sentenceCount: number;
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

function sentenceCount(text: string) {
  const count = text
    .split(/[.!?]+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean).length;
  return Math.max(1, count);
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
  passageTokens: string[];
  overlapTokens: string[];
}) {
  const supportTokens = unique([...params.overlapTokens, ...params.passageTokens]).slice(0, 4);
  const support = supportTokens.length > 0 ? supportTokens.join(", ") : "the passage";
  const starter = params.question ? `To answer the question (${params.question})` : "To answer the question";
  return `${starter}, I will use clear ideas from the passage, such as ${support}, and explain my answer in 2-3 linked sentences.`;
}

export function isReadingTaskType(taskType: string) {
  return READING_TASK_TYPES.includes(taskType as (typeof READING_TASK_TYPES)[number]);
}

export function evaluateReadingComprehension(input: ReadingAssessmentInput): ReadingAssessment {
  const passage = extractReadingPassage(input.taskPrompt);
  const question = extractReadingQuestion(input.taskPrompt);
  const answer = (input.transcript || "").trim();

  const passageTokens = normalizeTokens(passage);
  const questionTokens = normalizeTokens(question);
  const answerTokens = normalizeTokens(answer);

  const passageOverlap = overlap(passageTokens, answerTokens);
  const questionOverlap = overlap(questionTokens, answerTokens);

  const answerSentenceCount = sentenceCount(answer);
  const answerLengthScore = clamp((answerTokens.length / 28) * 100);
  const connectorBoost = /(because|so|therefore|for example|first|next|finally)/i.test(answer) ? 10 : 0;

  const sourceGrounding = clamp(passageOverlap.ratio * 100);
  const questionAddressing = clamp(questionOverlap.ratio * 65 + answerLengthScore * 0.25 + connectorBoost);
  const detailCoverage = clamp(
    Math.min(100, answerSentenceCount * 22) * 0.45 +
      Math.min(100, (passageOverlap.shared.length / Math.max(1, passageTokens.length)) * 100) * 0.55,
  );

  const overall = round(questionAddressing * 0.4 + sourceGrounding * 0.4 + detailCoverage * 0.2);

  const checks: RubricCheck[] = [
    {
      name: "reading_question_addressed",
      pass: questionAddressing >= 55,
      reason:
        questionAddressing >= 55
          ? "Answer addresses the reading question with a clear response."
          : "Answer only partially addresses the reading question.",
      weight: 0.34,
    },
    {
      name: "reading_source_grounding",
      pass: sourceGrounding >= 50,
      reason:
        sourceGrounding >= 50
          ? "Answer is grounded in passage content."
          : "Answer needs stronger support from passage details.",
      weight: 0.36,
    },
    {
      name: "reading_detail_coverage",
      pass: detailCoverage >= 52,
      reason:
        detailCoverage >= 52
          ? "Answer provides enough detail and sentence-level structure."
          : "Add at least one more supporting detail from the text.",
      weight: 0.3,
    },
  ];

  const passedReasons = checks.filter((item) => item.pass).map((item) => item.reason);
  const failedReasons = checks.filter((item) => !item.pass).map((item) => item.reason);

  return {
    version: READING_ASSESSMENT_VERSION,
    passage,
    question,
    scores: {
      questionAddressing: round(questionAddressing),
      sourceGrounding: round(sourceGrounding),
      detailCoverage: round(detailCoverage),
      overall,
    },
    signals: {
      passageTokenCount: passageTokens.length,
      answerTokenCount: answerTokens.length,
      questionTokenCount: questionTokens.length,
      overlappingPassageTokens: passageOverlap.shared.slice(0, 12),
      overlappingQuestionTokens: questionOverlap.shared.slice(0, 8),
      sentenceCount: answerSentenceCount,
      evidenceSpans: extractEvidenceSpans(answer),
    },
    rubricChecks: checks,
    feedback: {
      summary:
        overall >= 75
          ? "Strong reading response with clear support from the passage."
          : "You are close. Use more details from the passage in your answer.",
      whatWentWell:
        passedReasons.length > 0 ? passedReasons.slice(0, 3) : ["You completed the reading response."],
      whatToFixNow:
        failedReasons.length > 0
          ? failedReasons.slice(0, 3)
          : ["Keep linking your answer directly to the passage details."],
      exampleBetterAnswer: buildExampleAnswer({
        question,
        passageTokens,
        overlapTokens: passageOverlap.shared,
      }),
      nextMicroTask: "Re-answer the question in 3 sentences and cite 2 passage details.",
    },
  };
}

import { causalDiagnosisContractSchema, causalCoreLabels, normalizeCausalLabel, type CausalCoreLabel } from "@/lib/db/types";
import type { TaskEvaluation } from "@/lib/evaluator";
import type { SpeechMetrics } from "@/lib/scoring";

type InferenceScores = {
  taskScore?: number | null;
  languageScore?: number | null;
  overallScore?: number | null;
  reliability?: "high" | "medium" | "low";
};

export type CausalInferenceInput = {
  attemptId: string;
  studentId: string;
  taskType: string;
  transcript: string;
  speechMetrics: SpeechMetrics;
  taskEvaluation: TaskEvaluation;
  scores: InferenceScores;
  modelVersion?: string;
};

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits = 4) {
  return Number(value.toFixed(digits));
}

function toFinite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function splitWords(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function readArrayLen(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function readCheckFailRatio(checks: Array<{ pass: boolean }> | undefined) {
  if (!checks || checks.length === 0) return 0;
  const failed = checks.filter((check) => !check.pass).length;
  return failed / checks.length;
}

function lexicalL1Markers(tokens: string[]) {
  if (tokens.length === 0) return 0;
  const markerSet = new Set([
    "asante",
    "karibu",
    "sawa",
    "rafiki",
    "shule",
    "kweli",
    "habari",
    "mimi",
    "wewe",
    "pole",
  ]);
  let count = 0;
  for (const token of tokens) {
    if (markerSet.has(token)) {
      count += 1;
    }
  }
  return count;
}

function computeEntropy(distribution: Array<{ label: CausalCoreLabel; p: number }>) {
  const nonZero = distribution.filter((row) => row.p > 0);
  if (nonZero.length <= 1) return 0;
  const entropy = -nonZero.reduce((sum, row) => sum + row.p * Math.log(row.p), 0);
  return round(entropy / Math.log(nonZero.length));
}

function computeCounterfactual(topLabel: CausalCoreLabel, topMargin: number, supportCount: number) {
  const remediation: Record<CausalCoreLabel, string> = {
    rule_confusion: "Run minimal-pair grammar contrast task with explicit rule reminder.",
    l1_interference: "Run contrastive language interference drill with localized examples.",
    retrieval_failure: "Run retrieval micro-task with spaced lexical prompts.",
    instruction_misread: "Run instruction-check micro-task before main prompt.",
    attention_loss: "Switch to shorter prompt and add guided turn-taking cues.",
    production_constraint: "Reduce response load and allow scaffolded warm-up response.",
    mixed: "Run disambiguation probe to separate top competing causes.",
    unknown: "Run lightweight diagnostic probe before promotion-related decisions.",
  };
  return {
    suggestedRemediation: remediation[topLabel],
    disambiguationSuggested: topMargin < 0.12,
    evidenceSupport: supportCount,
  };
}

export function inferCausalDiagnosis(input: CausalInferenceInput) {
  const tokens = splitWords(input.transcript);
  const transcriptWordCount = input.speechMetrics.wordCount ?? tokens.length;

  const weights: Record<CausalCoreLabel, number> = {
    rule_confusion: 0.16,
    l1_interference: 0.08,
    retrieval_failure: 0.16,
    instruction_misread: 0.16,
    attention_loss: 0.12,
    production_constraint: 0.12,
    mixed: 0.1,
    unknown: 0.1,
  };

  const grammarFailRatio = readCheckFailRatio(input.taskEvaluation.grammarChecks);
  const loFailRatio = readCheckFailRatio(input.taskEvaluation.loChecks);
  const rubricFailRatio = readCheckFailRatio(input.taskEvaluation.rubricChecks);

  const grammarAccuracy = toFinite(input.taskEvaluation.artifacts?.grammarAccuracy);
  const missingWords = readArrayLen(input.taskEvaluation.artifacts?.missingWords);
  const usedWords = readArrayLen(input.taskEvaluation.artifacts?.requiredWordsUsed);
  const targetWordsTotal = missingWords + usedWords;
  const missingRatio = targetWordsTotal > 0 ? missingWords / targetWordsTotal : 0;
  const confidence = toFinite(input.speechMetrics.confidence);
  const speechRate = toFinite(input.speechMetrics.speechRate);
  const fillerCount = toFinite(input.speechMetrics.fillerCount) ?? 0;
  const pauseCount = toFinite(input.speechMetrics.pauseCount) ?? 0;
  const durationSec = toFinite(input.speechMetrics.durationSec);

  if (grammarFailRatio > 0) {
    weights.rule_confusion += grammarFailRatio * 1.25;
  }
  if (grammarAccuracy !== null && grammarAccuracy < 60) {
    weights.rule_confusion += ((60 - grammarAccuracy) / 60) * 0.9;
  }

  if (missingRatio > 0) {
    weights.retrieval_failure += missingRatio * 1.15;
  }
  if (targetWordsTotal > 0 && missingWords === targetWordsTotal) {
    weights.retrieval_failure += 0.25;
  }

  if (
    input.taskEvaluation.taskScore <= 50 &&
    grammarFailRatio <= 0.35 &&
    loFailRatio > 0 &&
    transcriptWordCount >= 12
  ) {
    weights.instruction_misread += 0.75;
  }
  if (rubricFailRatio > 0.5 && grammarFailRatio < 0.3) {
    weights.instruction_misread += 0.35;
  }

  if (fillerCount >= 6 || pauseCount >= 8) {
    weights.attention_loss += 0.55;
  }
  if (transcriptWordCount < 8) {
    weights.attention_loss += 0.3;
  }

  if ((durationSec !== null && durationSec < 8) || transcriptWordCount < 6) {
    weights.production_constraint += 0.65;
  }
  if (speechRate !== null && (speechRate < 65 || speechRate > 185)) {
    weights.production_constraint += 0.3;
  }
  if (confidence !== null && confidence < 0.45) {
    weights.production_constraint += 0.25;
    weights.attention_loss += 0.2;
  }

  const l1MarkerCount = lexicalL1Markers(tokens);
  if (l1MarkerCount > 0) {
    weights.l1_interference += Math.min(0.9, 0.35 + l1MarkerCount * 0.15);
  }

  const reliability = input.scores.reliability || "medium";
  if (reliability === "low") {
    weights.unknown += 0.3;
  }

  const supportCount =
    input.taskEvaluation.rubricChecks.length +
    input.taskEvaluation.grammarChecks.length +
    input.taskEvaluation.loChecks.length +
    targetWordsTotal;
  if (supportCount < 4) {
    weights.unknown += 0.35;
  }

  const sortedRaw = causalCoreLabels
    .map((label) => ({ label: normalizeCausalLabel(label), p: Math.max(0.001, weights[label]) }))
    .sort((left, right) => right.p - left.p);

  const topRaw = sortedRaw[0];
  const secondRaw = sortedRaw[1] || { label: "unknown" as CausalCoreLabel, p: 0 };
  if (topRaw.p - secondRaw.p < 0.12) {
    const mixedRow = sortedRaw.find((row) => row.label === "mixed");
    if (mixedRow) mixedRow.p += 0.22;
  }
  if (topRaw.p < 0.24) {
    const unknownRow = sortedRaw.find((row) => row.label === "unknown");
    if (unknownRow) unknownRow.p += 0.18;
  }

  const total = sortedRaw.reduce((sum, row) => sum + row.p, 0);
  const distribution = sortedRaw
    .map((row) => ({
      label: row.label,
      p: round(row.p / total),
    }))
    .sort((left, right) => right.p - left.p);

  const top = distribution[0];
  const second = distribution[1] || { label: "unknown" as CausalCoreLabel, p: 0 };
  const topMargin = round(Math.max(0, top.p - second.p));
  const entropy = computeEntropy(distribution);

  const normalizedSupport = clamp((supportCount + Math.floor(transcriptWordCount / 20)) / 18);
  const intervalRadius = round(clamp(0.06, 0.28, 0.28 - normalizedSupport * 0.16 + (1 - top.p) * 0.08));
  const confidenceInterval = {
    lower: round(clamp(top.p - intervalRadius)),
    upper: round(clamp(top.p + intervalRadius)),
  };

  return causalDiagnosisContractSchema.parse({
    attemptId: input.attemptId,
    studentId: input.studentId,
    modelVersion: input.modelVersion || "causal-inference-v1",
    topLabel: top.label,
    topProbability: top.p,
    entropy,
    topMargin,
    distribution,
    confidenceInterval,
    counterfactual: computeCounterfactual(top.label, topMargin, supportCount),
  });
}

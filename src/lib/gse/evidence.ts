import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import {
  applyEvidenceToStudentMastery,
  EvidenceActivationImpact,
  GseEvidenceKind,
  GseOpportunityType,
  MasteryEvidence,
  NodeMasteryOutcome,
} from "./mastery";
import { confidenceFromReliability, mapStageToGseRange } from "./utils";
import { extractRequiredWords } from "@/lib/taskText";

type DerivedMetrics = {
  speechRate?: number;
  pronunciationTargetRef?: number;
  pronunciationSelfRef?: number;
  pronunciation?: number;
  fluency?: number;
};

type TaskEvaluation = {
  taskScore: number;
  artifacts?: Record<string, unknown>;
  rubricChecks?: Array<{ name?: string; pass?: boolean; weight?: number; reason?: string }>;
  loChecks?: Array<{
    checkId?: string;
    label?: string;
    pass?: boolean;
    confidence?: number;
    severity?: "low" | "medium" | "high";
    evidenceSpan?: string;
  }>;
  grammarChecks?: Array<{
    checkId?: string;
    descriptorId?: string;
    label?: string;
    pass?: boolean;
    confidence?: number;
    opportunityType?: "explicit_target" | "elicited_incidental" | "incidental";
    errorType?: string;
    evidenceSpan?: string;
    correction?: string;
  }>;
};

type TargetNode = {
  nodeId: string;
  weight: number;
  required: boolean;
  node: {
    nodeId: string;
    type: "GSE_LO" | "GSE_VOCAB" | "GSE_GRAMMAR";
    sourceKey: string;
    descriptor: string;
    skill: string | null;
    metadataJson: unknown;
  };
};

type EvidenceDraft = {
  nodeId: string;
  signalType: string;
  evidenceKind: GseEvidenceKind;
  opportunityType: GseOpportunityType;
  score: number;
  confidence: number;
  impact: number;
  weight: number;
  source: string;
  domain: "vocab" | "grammar" | "lo";
  usedForPromotion: boolean;
  targeted: boolean;
  activationImpact: EvidenceActivationImpact;
  evidenceText?: string;
  reliability: "high" | "medium" | "low";
  metadataJson?: Record<string, unknown> | null;
};

type AgeBand = "6-8" | "9-11" | "12-14";

export type BuildAttemptEvidenceInput = {
  attemptId: string;
  studentId: string;
  taskId: string;
  taskType: string;
  taskPrompt: string;
  taskMeta?: Record<string, unknown> | null;
  transcript: string;
  derivedMetrics: DerivedMetrics;
  taskEvaluation: TaskEvaluation;
  scoreReliability: "high" | "medium" | "low";
  ageBand?: string | null;
};

export type BuildOpportunityEvidenceInput = {
  taskType: string;
  taskPrompt: string;
  taskMeta?: Record<string, unknown> | null;
  transcript: string;
  derivedMetrics: DerivedMetrics;
  taskEvaluation: TaskEvaluation;
  scoreReliability: "high" | "medium" | "low";
  taskTargets: TargetNode[];
  ageBand?: string | null;
  /** For target_vocab: required words from prompt that match each node (by descriptor/alias). Enables "word used" = direct evidence. */
  targetNodeIdToExtraLexicalForms?: Record<string, { lemmas: string[]; phrases: string[] }>;
};

const SOURCE_RELIABILITY_FACTOR: Record<"high" | "medium" | "low", number> = {
  high: 1,
  medium: 0.8,
  low: 0.6,
};
const EVIDENCE_RULE_VERSION = "gse-evidence-v2.1";
const STOPWORDS = new Set([
  "the",
  "and",
  "that",
  "this",
  "with",
  "from",
  "have",
  "they",
  "were",
  "been",
  "your",
  "about",
  "there",
  "then",
  "into",
  "than",
  "them",
  "very",
  "just",
  "like",
]);

const AGE_DOMAIN_CALIBRATION: Record<
  AgeBand,
  Record<"vocab" | "grammar" | "lo", { direct: number; supporting: number; negative: number; incidental: number }>
> = {
  "6-8": {
    vocab: { direct: 1.0, supporting: 0.75, negative: 0.85, incidental: 0.9 },
    grammar: { direct: 0.9, supporting: 0.7, negative: 0.8, incidental: 0.85 },
    lo: { direct: 1.0, supporting: 0.8, negative: 0.9, incidental: 0.9 },
  },
  "9-11": {
    vocab: { direct: 1.0, supporting: 1.0, negative: 1.0, incidental: 1.0 },
    grammar: { direct: 1.0, supporting: 1.0, negative: 1.0, incidental: 1.0 },
    lo: { direct: 1.0, supporting: 1.0, negative: 1.0, incidental: 1.0 },
  },
  "12-14": {
    vocab: { direct: 1.0, supporting: 0.9, negative: 1.0, incidental: 0.95 },
    grammar: { direct: 1.1, supporting: 0.95, negative: 1.05, incidental: 1.0 },
    lo: { direct: 1.05, supporting: 0.9, negative: 1.0, incidental: 0.95 },
  },
};

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function mapTranscriptToWordSet(input: string) {
  return Array.from(
    new Set(
      input
        .toLowerCase()
        .replace(/[^a-z0-9'\s]/g, " ")
        .split(/\s+/)
        .filter(Boolean)
    )
  );
}

function baseWeight(kind: GseEvidenceKind, opportunity: GseOpportunityType) {
  if (kind === "direct" && opportunity === "explicit_target") return 1;
  if (kind === "direct" && opportunity === "elicited_incidental") return 0.65;
  if (kind === "supporting" && opportunity === "incidental") return 0.35;
  if (kind === "negative" && opportunity === "explicit_target") return 0.9;
  if (kind === "negative" && opportunity === "incidental") return 0.4;
  return 0.3;
}

function normalizeAgeBand(value?: string | null): AgeBand {
  if (value === "6-8" || value === "12-14") return value;
  return "9-11";
}

function calibrationFactor(params: {
  ageBand?: string | null;
  domain: "vocab" | "grammar" | "lo";
  kind: GseEvidenceKind;
  opportunity: GseOpportunityType;
}) {
  const ageBand = normalizeAgeBand(params.ageBand);
  const matrix = AGE_DOMAIN_CALIBRATION[ageBand][params.domain];
  const kindFactor =
    params.kind === "direct" ? matrix.direct : params.kind === "negative" ? matrix.negative : matrix.supporting;
  const incidentalFactor =
    params.opportunity === "explicit_target" ? 1 : params.opportunity === "elicited_incidental" ? 0.95 : matrix.incidental;
  return Number((kindFactor * incidentalFactor).toFixed(4));
}

function computeWeight(params: {
  kind: GseEvidenceKind;
  opportunity: GseOpportunityType;
  confidence: number;
  reliability: "high" | "medium" | "low";
  impact: number;
  domain: "vocab" | "grammar" | "lo";
  ageBand?: string | null;
}) {
  const raw =
    baseWeight(params.kind, params.opportunity) *
    clamp01(params.confidence) *
    SOURCE_RELIABILITY_FACTOR[params.reliability] *
    Math.max(0.2, clamp01(params.impact)) *
    calibrationFactor({
      ageBand: params.ageBand,
      domain: params.domain,
      kind: params.kind,
      opportunity: params.opportunity,
    });
  return Number(Math.max(0.05, Math.min(1.2, raw)).toFixed(4));
}

function normalizeWord(word: string) {
  return word.toLowerCase().replace(/[^a-z0-9']/g, "").trim();
}

function normalizePhrase(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isHumanLexeme(value: string) {
  const normalized = normalizePhrase(value);
  return /^[a-z][a-z0-9' -]{1,48}$/.test(normalized) && !normalized.includes("ua8444");
}

function toLemma(token: string) {
  const word = normalizeWord(token);
  if (word.length <= 2) return word;
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`;
  if (word.endsWith("ing") && word.length > 5) return word.slice(0, -3);
  if (word.endsWith("ed") && word.length > 4) return word.slice(0, -2);
  if (word.endsWith("es") && word.length > 4) return word.slice(0, -2);
  if (word.endsWith("s") && word.length > 3) return word.slice(0, -1);
  return word;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function extractVariantStrings(metadataJson: unknown) {
  if (!metadataJson || typeof metadataJson !== "object") return [];
  const row = metadataJson as Record<string, unknown>;
  const variants = row.variants;
  if (!Array.isArray(variants)) return [];
  const values: string[] = [];
  for (const variant of variants) {
    if (typeof variant === "string") {
      values.push(variant);
      continue;
    }
    if (!variant || typeof variant !== "object") continue;
    for (const key of ["value", "name", "variant", "term", "label", "description"]) {
      const raw = (variant as Record<string, unknown>)[key];
      if (typeof raw === "string" && raw.trim().length > 0) {
        values.push(raw);
      }
    }
  }
  return values;
}

function buildNgrams(words: string[], maxN = 3) {
  const out: string[] = [];
  for (let i = 0; i < words.length; i += 1) {
    for (let n = 1; n <= maxN; n += 1) {
      if (i + n > words.length) continue;
      out.push(words.slice(i, i + n).join(" "));
    }
  }
  return uniqueStrings(out);
}

function buildVocabLexicalForms(targetNode: TargetNode["node"]) {
  const tokensFromDescriptor = tokenize(targetNode.descriptor);
  const descriptorLooksLexical = tokensFromDescriptor.length > 0 && tokensFromDescriptor.length <= 5;
  const candidateStrings = [
    descriptorLooksLexical ? targetNode.descriptor : "",
    isHumanLexeme(targetNode.sourceKey) ? targetNode.sourceKey : "",
    ...extractVariantStrings(targetNode.metadataJson),
  ]
    .map(normalizePhrase)
    .filter((value) => value.length > 0);

  const phrases = new Set<string>();
  const lemmas = new Set<string>();
  for (const candidate of candidateStrings) {
    phrases.add(candidate);
    for (const token of candidate.split(" ")) {
      const normalized = normalizeWord(token);
      if (normalized.length < 2) continue;
      lemmas.add(toLemma(normalized));
    }
  }

  return {
    phrases: Array.from(phrases),
    lemmas: Array.from(lemmas),
  };
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((v) => v.length > 2);
}

function overlapScore(a: string, b: string) {
  const as = new Set(tokenize(a));
  const bs = new Set(tokenize(b));
  if (as.size === 0 || bs.size === 0) return 0;
  let hit = 0;
  for (const token of as) {
    if (bs.has(token)) hit += 1;
  }
  return hit / Math.max(as.size, bs.size);
}

function checkPassRatio(taskEvaluation: TaskEvaluation) {
  const checks = Array.isArray(taskEvaluation.rubricChecks) ? taskEvaluation.rubricChecks : [];
  if (!checks.length) return taskEvaluation.taskScore >= 70 ? 0.8 : taskEvaluation.taskScore >= 50 ? 0.5 : 0.2;
  const total = checks.reduce((sum, c) => sum + (typeof c.weight === "number" ? c.weight : 0.2), 0) || 1;
  const passed = checks.reduce(
    (sum, c) =>
      sum + (c.pass ? (typeof c.weight === "number" ? c.weight : 0.2) : 0),
    0
  );
  return clamp01(passed / total);
}

function normalizedLoChecks(taskEvaluation: TaskEvaluation) {
  const fromModel = Array.isArray(taskEvaluation.loChecks) ? taskEvaluation.loChecks : [];
  if (fromModel.length > 0) {
    return fromModel.map((check, index) => ({
      checkId: String(check.checkId || `lo_${index + 1}`),
      label: String(check.label || `LO check ${index + 1}`),
      pass: Boolean(check.pass),
      confidence: clamp01(typeof check.confidence === "number" ? check.confidence : 0.72),
      severity: check.severity || "medium",
      evidenceSpan: check.evidenceSpan ? String(check.evidenceSpan).slice(0, 220) : undefined,
    }));
  }
  const fallbackRubric = Array.isArray(taskEvaluation.rubricChecks) ? taskEvaluation.rubricChecks : [];
  return fallbackRubric.map((check, index) => ({
    checkId: `rubric_${index + 1}`,
    label: String(check.name || `rubric_${index + 1}`),
    pass: Boolean(check.pass),
    confidence: clamp01(0.6 + (typeof check.weight === "number" ? check.weight : 0.2) * 0.35),
    severity: check.pass ? "low" : (typeof check.weight === "number" && check.weight >= 0.4 ? "high" : "medium"),
    evidenceSpan: check.reason ? String(check.reason).slice(0, 220) : undefined,
  }));
}

function normalizedGrammarChecks(taskEvaluation: TaskEvaluation, transcript: string) {
  const fromModel = Array.isArray(taskEvaluation.grammarChecks) ? taskEvaluation.grammarChecks : [];
  if (fromModel.length > 0) {
    return fromModel.map((check, index) => ({
      checkId: String(check.checkId || `grammar_${index + 1}`),
      descriptorId: check.descriptorId ? String(check.descriptorId) : undefined,
      label: String(check.label || `Grammar check ${index + 1}`),
      pass: Boolean(check.pass),
      confidence: clamp01(typeof check.confidence === "number" ? check.confidence : 0.72),
      opportunityType: check.opportunityType || "incidental",
      errorType: check.errorType ? String(check.errorType) : undefined,
      evidenceSpan: check.evidenceSpan ? String(check.evidenceSpan).slice(0, 220) : transcript.slice(0, 160),
      correction: check.correction ? String(check.correction) : undefined,
    }));
  }

  const grammarAccuracy =
    typeof taskEvaluation.artifacts?.grammarAccuracy === "number"
      ? clamp01(taskEvaluation.artifacts.grammarAccuracy / 100)
      : null;
  if (grammarAccuracy !== null) {
    return [
      {
        checkId: "grammar_accuracy",
        descriptorId: undefined,
        label: "Grammar accuracy",
        pass: grammarAccuracy >= 0.68,
        confidence: 0.8,
        opportunityType: "elicited_incidental" as const,
        errorType: grammarAccuracy >= 0.68 ? undefined : "mixed",
        evidenceSpan: transcript.slice(0, 160),
        correction: undefined,
      },
    ];
  }
  return [
    {
      checkId: "grammar_incidental_usage",
      descriptorId: undefined,
      label: "Grammar in context",
      pass: transcript.trim().length >= 20,
      confidence: 0.62,
      opportunityType: "incidental" as const,
      errorType: undefined,
      evidenceSpan: transcript.slice(0, 160),
      correction: undefined,
    },
  ];
}

function makeEvidence(params: {
  nodeId: string;
  signalType: string;
  kind: GseEvidenceKind;
  opportunity: GseOpportunityType;
  score: number;
  confidence: number;
  impact: number;
  source: string;
  domain: "vocab" | "grammar" | "lo";
  usedForPromotion: boolean;
  targeted?: boolean;
  activationImpact?: EvidenceActivationImpact;
  reliability: "high" | "medium" | "low";
  ageBand?: string | null;
  evidenceText?: string;
  metadataJson?: Record<string, unknown> | null;
}): EvidenceDraft {
  return {
    nodeId: params.nodeId,
    signalType: params.signalType,
    evidenceKind: params.kind,
    opportunityType: params.opportunity,
    score: Number(clamp01(params.score).toFixed(4)),
    confidence: Number(clamp01(params.confidence).toFixed(4)),
    impact: Number(Math.max(0.1, Math.min(1, params.impact)).toFixed(4)),
    weight: computeWeight({
      kind: params.kind,
      opportunity: params.opportunity,
      confidence: params.confidence,
      reliability: params.reliability,
      impact: params.impact,
      domain: params.domain,
      ageBand: params.ageBand,
    }),
    source: params.source,
    domain: params.domain,
    usedForPromotion: params.usedForPromotion,
    targeted: params.targeted !== false,
    activationImpact: params.activationImpact || "none",
    evidenceText: params.evidenceText,
    reliability: params.reliability,
    metadataJson: params.metadataJson ?? null,
  };
}

export function buildOpportunityEvidence(input: BuildOpportunityEvidenceInput) {
  const created: EvidenceDraft[] = [];
  const reliability = input.scoreReliability;
  const defaultConf = confidenceFromReliability(reliability);
  const wordsRaw = mapTranscriptToWordSet(input.transcript).map(normalizeWord);
  const lemmaSet = new Set(wordsRaw.map(toLemma));
  const transcriptPhrase = normalizePhrase(input.transcript);
  const transcriptPhrasePadded = ` ${transcriptPhrase} `;
  const passRatio = checkPassRatio(input.taskEvaluation);
  const loChecks = normalizedLoChecks(input.taskEvaluation);
  const grammarChecks = normalizedGrammarChecks(input.taskEvaluation, input.transcript);
  const requiredWords = new Set(
    [
      ...extractRequiredWords(input.taskPrompt),
      ...(Array.isArray(input.taskMeta?.requiredWords)
        ? input.taskMeta.requiredWords.map((w) => String(w).toLowerCase())
        : []),
    ].map(normalizeWord)
  );
  const requiredWordLemmas = new Set(Array.from(requiredWords).map(toLemma));

  for (const target of input.taskTargets) {
    const nodeType = target.node.type;
    const impact = Math.max(0.2, Math.min(1, target.weight || 1));

    if (nodeType === "GSE_LO") {
      const targetHint = `${target.node.descriptor} ${input.taskPrompt}`;
      const selectedCheck =
        [...loChecks]
          .sort((a, b) => overlapScore(b.label, targetHint) - overlapScore(a.label, targetHint))[0] || null;
      const positive = selectedCheck ? selectedCheck.pass : passRatio >= 0.55;
      const score = selectedCheck
        ? (selectedCheck.pass ? selectedCheck.confidence : 1 - selectedCheck.confidence)
        : positive
        ? passRatio
        : 1 - passRatio;
      created.push(
        makeEvidence({
          nodeId: target.nodeId,
          signalType: positive ? "lo_check_pass" : "lo_check_fail",
          kind: positive ? "direct" : "negative",
          opportunity: "explicit_target",
          score,
          confidence: selectedCheck ? selectedCheck.confidence : defaultConf,
          impact,
          source: "rules",
          domain: "lo",
          usedForPromotion: true,
          reliability,
          ageBand: input.ageBand,
          evidenceText: input.transcript.slice(0, 220),
          metadataJson: {
            checkId: selectedCheck?.checkId || null,
            ruleVersion: EVIDENCE_RULE_VERSION,
            severity: selectedCheck?.severity || null,
          },
        })
      );
      continue;
    }

    if (nodeType === "GSE_VOCAB") {
      const baseForms = buildVocabLexicalForms(target.node);
      const extra = input.targetNodeIdToExtraLexicalForms?.[target.nodeId];
      const lexicalForms = {
        lemmas: extra ? [...baseForms.lemmas, ...extra.lemmas] : baseForms.lemmas,
        phrases: extra ? [...baseForms.phrases, ...extra.phrases] : baseForms.phrases,
      };
      const wasUsed = lexicalForms.lemmas.some((lemma) => lemmaSet.has(lemma)) ||
        lexicalForms.phrases.some((phrase) => transcriptPhrasePadded.includes(` ${phrase} `));
      const explicitWordTask =
        input.taskType === "target_vocab" ||
        lexicalForms.lemmas.some((lemma) => requiredWordLemmas.has(lemma)) ||
        lexicalForms.phrases.some((phrase) => requiredWords.has(phrase));
      const isReadAloud = input.taskType === "read_aloud";

      if (isReadAloud) {
        // read_aloud cannot directly prove lexical meaning.
        created.push(
          makeEvidence({
            nodeId: target.nodeId,
            signalType: "vocab_read_aloud_support",
            kind: "supporting",
            opportunity: "incidental",
            score: wasUsed ? 0.55 : 0.35,
            confidence: defaultConf * 0.6,
            impact: Math.min(0.2, impact),
            source: "rules",
            domain: "vocab",
            usedForPromotion: false,
            reliability: "low",
            ageBand: input.ageBand,
            evidenceText: input.transcript.slice(0, 220),
            metadataJson: {
              checkId: "vocab_read_aloud_support",
              ruleVersion: EVIDENCE_RULE_VERSION,
            },
          })
        );
        continue;
      }

      if (explicitWordTask) {
        created.push(
          makeEvidence({
            nodeId: target.nodeId,
            signalType: wasUsed ? "vocab_target_used" : "vocab_target_missing",
            kind: wasUsed ? "direct" : "negative",
            opportunity: "explicit_target",
            score: wasUsed ? 1 : 0,
            confidence: defaultConf,
            impact,
            source: "rules",
            domain: "vocab",
            usedForPromotion: true,
            reliability,
            ageBand: input.ageBand,
            evidenceText: input.transcript.slice(0, 220),
            metadataJson: {
              checkId: wasUsed ? "vocab_target_used" : "vocab_target_missing",
              ruleVersion: EVIDENCE_RULE_VERSION,
            },
          })
        );
      } else if (wasUsed) {
        created.push(
          makeEvidence({
            nodeId: target.nodeId,
            signalType: "vocab_incidental_used",
            kind: "supporting",
            opportunity: "incidental",
            score: 0.7,
            confidence: defaultConf * 0.75,
            impact: Math.min(0.45, impact),
            source: "rules",
            domain: "vocab",
            usedForPromotion: false,
            reliability: "medium",
            ageBand: input.ageBand,
            evidenceText: input.transcript.slice(0, 220),
            metadataJson: {
              checkId: "vocab_incidental_used",
              ruleVersion: EVIDENCE_RULE_VERSION,
            },
          })
        );
      }
      continue;
    }

    if (nodeType === "GSE_GRAMMAR") {
      const selectedCheck =
        grammarChecks
          .filter((check) => check.descriptorId && check.descriptorId === target.node.sourceKey)
          .sort((a, b) => b.confidence - a.confidence)[0] || null;
      if (!selectedCheck) continue;
      const grammarScore = selectedCheck.confidence;
      const correctEnough = selectedCheck.pass;
      created.push(
        makeEvidence({
          nodeId: target.nodeId,
          signalType: correctEnough ? "grammar_construct_ok" : "grammar_construct_error",
          kind: correctEnough ? "direct" : "negative",
          opportunity: selectedCheck?.opportunityType
            ? selectedCheck.opportunityType
            : input.taskType === "read_aloud"
            ? "incidental"
            : "elicited_incidental",
          score: grammarScore,
          confidence: selectedCheck ? selectedCheck.confidence : defaultConf,
          impact,
          source: "rules",
          domain: "grammar",
          usedForPromotion: true,
          reliability,
          ageBand: input.ageBand,
          evidenceText: input.transcript.slice(0, 220),
          metadataJson: {
            checkId: selectedCheck?.checkId || null,
            ruleVersion: EVIDENCE_RULE_VERSION,
            errorType: selectedCheck?.errorType || null,
            correction: selectedCheck?.correction || null,
          },
        })
      );
    }
  }

  const explicitLoNegatives = created.filter(
    (row) => row.domain === "lo" && row.opportunityType === "explicit_target" && row.evidenceKind === "negative"
  );
  const inconsistent = input.taskEvaluation.taskScore <= 45 && explicitLoNegatives.length === 0;
  if (inconsistent && input.taskTargets.some((target) => target.node.type === "GSE_LO")) {
    const firstLo = input.taskTargets.find((target) => target.node.type === "GSE_LO");
    if (firstLo) {
      created.push(
        makeEvidence({
          nodeId: firstLo.nodeId,
          signalType: "lo_check_negative_required",
          kind: "negative",
          opportunity: "explicit_target",
          score: 0.2,
          confidence: 0.92,
          impact: Math.max(0.35, Math.min(1, firstLo.weight || 1)),
          source: "rules",
          domain: "lo",
          usedForPromotion: true,
          reliability,
          ageBand: input.ageBand,
          evidenceText: input.transcript.slice(0, 220),
          metadataJson: {
            checkId: "lo_check_negative_required",
            ruleVersion: EVIDENCE_RULE_VERSION,
            consistencyFlag: "inconsistent_lo_signal_repaired",
          },
        })
      );
    }
  }

  // Speech-only nodes (pronunciation/fluency) can still get direct evidence.
  const metricSignals: Array<{ key: string; score?: number; signalType: string }> = [
    {
      key: "pronunciation",
      score:
        input.derivedMetrics.pronunciationTargetRef ??
        input.derivedMetrics.pronunciationSelfRef ??
        input.derivedMetrics.pronunciation,
      signalType: "speech_pronunciation",
    },
    {
      key: "fluency",
      score: input.derivedMetrics.fluency,
      signalType: "speech_fluency",
    },
  ];

  return { created, metricSignals, consistency: { lowTaskScore: input.taskEvaluation.taskScore <= 45, inconsistent } };
}

export async function persistAttemptGseEvidence(input: BuildAttemptEvidenceInput) {
  const taskTargets = await prisma.taskGseTarget.findMany({
    where: { taskId: input.taskId },
    include: {
      node: {
        select: {
          nodeId: true,
          type: true,
          sourceKey: true,
          descriptor: true,
          skill: true,
          metadataJson: true,
        },
      },
    },
  });

  const requiredWordsList = [
    ...extractRequiredWords(input.taskPrompt),
    ...(Array.isArray(input.taskMeta?.requiredWords)
      ? input.taskMeta.requiredWords.map((w) => String(w).toLowerCase())
      : []),
  ].map(normalizeWord).filter(Boolean);
  const requiredWordsSet = new Set(requiredWordsList);

  let targetNodeIdToExtraLexicalForms: Record<string, { lemmas: string[]; phrases: string[] }> | undefined;
  if (input.taskType === "target_vocab" && requiredWordsList.length > 0) {
    const vocabTargets = taskTargets.filter((row) => row.node.type === "GSE_VOCAB");
    const vocabNodeIds = vocabTargets.map((row) => row.nodeId);
    const aliases = vocabNodeIds.length > 0
      ? await prisma.gseNodeAlias.findMany({
          where: { nodeId: { in: vocabNodeIds } },
          select: { nodeId: true, alias: true },
        })
      : [];
    const aliasByNode = new Map<string, string[]>();
    for (const a of aliases) {
      const list = aliasByNode.get(a.nodeId) ?? [];
      list.push(normalizePhrase(a.alias));
      aliasByNode.set(a.nodeId, list);
    }
    targetNodeIdToExtraLexicalForms = {};
    for (const row of vocabTargets) {
      const nodeDescriptor = normalizePhrase(row.node.descriptor ?? "");
      const nodeAliases = aliasByNode.get(row.nodeId) ?? [];
      const lemmas = new Set<string>();
      const phrases = new Set<string>();
      for (const word of requiredWordsList) {
        const wordLemma = toLemma(word);
        const matchesDescriptor = nodeDescriptor.length >= 2 && (word === nodeDescriptor || wordLemma === toLemma(nodeDescriptor));
        const matchesAlias = nodeAliases.some((al) => al === word || toLemma(al) === wordLemma);
        if (matchesDescriptor || matchesAlias) {
          lemmas.add(wordLemma);
          phrases.add(word);
        }
      }
      if (lemmas.size > 0 || phrases.size > 0) {
        targetNodeIdToExtraLexicalForms[row.nodeId] = {
          lemmas: Array.from(lemmas),
          phrases: Array.from(phrases),
        };
      }
    }
  }

  const { created, metricSignals, consistency } = buildOpportunityEvidence({
    taskType: input.taskType,
    taskPrompt: input.taskPrompt,
    taskMeta: input.taskMeta,
    transcript: input.transcript,
    derivedMetrics: input.derivedMetrics,
    taskEvaluation: input.taskEvaluation,
    scoreReliability: input.scoreReliability,
    taskTargets: taskTargets as TargetNode[],
    ageBand: input.ageBand,
    targetNodeIdToExtraLexicalForms,
  });

  const targetNodeIds = new Set(taskTargets.map((row) => row.nodeId));
  const incidentalDefaultConf = confidenceFromReliability(input.scoreReliability);

  const transcriptWords = mapTranscriptToWordSet(input.transcript)
    .map(normalizeWord)
    .filter((word) => word.length >= 3 && !requiredWordsSet.has(word) && !STOPWORDS.has(word))
    .slice(0, 120);
  const transcriptLemmas = uniqueStrings(transcriptWords.map(toLemma)).filter((word) => word.length >= 3);
  const transcriptCandidates = uniqueStrings([...transcriptWords, ...transcriptLemmas]);
  const transcriptPhraseTokens = normalizePhrase(input.transcript).split(" ").filter((token) => token.length >= 2);
  const transcriptNgrams = buildNgrams(transcriptPhraseTokens, 3).filter((phrase) => phrase.length >= 3).slice(0, 220);
  const aliasCandidates = uniqueStrings([...transcriptCandidates, ...transcriptNgrams]).slice(0, 300);
  if (transcriptWords.length > 0) {
    const [vocabNodesByAlias, vocabNodesByDescriptor] = await Promise.all([
      prisma.gseNodeAlias.findMany({
        where: {
          alias: { in: aliasCandidates },
          node: { type: "GSE_VOCAB" },
        },
        select: {
          alias: true,
          nodeId: true,
        },
        take: 600,
      }),
      prisma.gseNode.findMany({
        where: {
          type: "GSE_VOCAB",
          descriptor: { in: transcriptCandidates },
        },
        select: { nodeId: true, descriptor: true },
        take: 300,
      }),
    ]);

    const vocabMatches = new Map<string, { nodeId: string; matchedWord: string }>();
    for (const row of vocabNodesByDescriptor) {
      vocabMatches.set(row.nodeId, { nodeId: row.nodeId, matchedWord: normalizePhrase(row.descriptor) });
    }
    for (const row of vocabNodesByAlias) {
      if (!vocabMatches.has(row.nodeId)) {
        vocabMatches.set(row.nodeId, { nodeId: row.nodeId, matchedWord: normalizePhrase(row.alias) });
      }
    }

    let added = 0;
    for (const match of vocabMatches.values()) {
      if (targetNodeIds.has(match.nodeId)) continue;
      if (added >= 10) break;
      created.push(
        makeEvidence({
          nodeId: match.nodeId,
          signalType: "vocab_incidental_discovery",
          kind: "supporting",
          opportunity: "incidental",
          score: 0.68,
          confidence: incidentalDefaultConf * 0.74,
          impact: 0.25,
          source: "rules",
          domain: "vocab",
          usedForPromotion: false,
          targeted: false,
          activationImpact: "observed",
          reliability: "medium",
          ageBand: input.ageBand,
          evidenceText: input.transcript.slice(0, 220),
          metadataJson: {
            checkId: "vocab_incidental_discovery",
            matchedWord: match.matchedWord,
            ruleVersion: EVIDENCE_RULE_VERSION,
          },
        })
      );
      added += 1;
    }
  }

  const grammarChecksRaw = normalizedGrammarChecks(input.taskEvaluation, input.transcript);
  const grammarChecks = grammarChecksRaw.filter((check) => check.confidence >= 0.68 && check.descriptorId);
  if (grammarChecks.length > 0) {
    const stageRaw = typeof input.taskMeta?.stage === "string" ? input.taskMeta.stage : "A2";
    const stageRange = mapStageToGseRange(stageRaw);
    const grammarCandidates = await prisma.gseNode.findMany({
      where: {
        type: "GSE_GRAMMAR",
        gseCenter: { gte: stageRange.min - 10, lte: stageRange.max + 10 },
        descriptor: { notIn: ["", "No grammar descriptor available."] },
      },
      orderBy: [{ gseCenter: "asc" }],
      select: { nodeId: true, descriptor: true, sourceKey: true },
      take: 220,
    });

    const usedGrammarNodeIds = new Set(created.filter((row) => row.domain === "grammar").map((row) => row.nodeId));
    let grammarAdded = 0;
    for (const check of grammarChecks) {
      if (grammarAdded >= 6) break;
      const best = grammarCandidates.find((node) => node.sourceKey === check.descriptorId);
      if (!best) continue;
      if (targetNodeIds.has(best.nodeId) || usedGrammarNodeIds.has(best.nodeId)) continue;
      const pass = check.pass;
      created.push(
        makeEvidence({
          nodeId: best.nodeId,
          signalType: pass ? "grammar_incidental_discovery" : "grammar_incidental_error",
          kind: pass ? "supporting" : "negative",
          opportunity: "incidental",
          score: pass ? Math.max(0.62, Math.min(0.9, check.confidence * 0.92)) : Math.max(0.1, 1 - check.confidence),
          confidence: check.confidence,
          impact: 0.3,
          source: "rules",
          domain: "grammar",
          usedForPromotion: false,
          targeted: false,
          activationImpact: "observed",
          reliability: "medium",
          ageBand: input.ageBand,
          evidenceText: check.evidenceSpan || input.transcript.slice(0, 220),
          metadataJson: {
            checkId: check.checkId,
            ruleVersion: EVIDENCE_RULE_VERSION,
            matchScore: 1,
            errorType: check.errorType || null,
          },
        })
      );
      usedGrammarNodeIds.add(best.nodeId);
      grammarAdded += 1;
    }
  }

  const metricNodeKeys = metricSignals.map((s) => s.key);
  const metricNodes = await prisma.gseNode.findMany({
    where: { sourceKey: { in: metricNodeKeys } },
    select: { nodeId: true, sourceKey: true, type: true },
  });

  for (const signal of metricSignals) {
    const node = metricNodes.find((row) => row.sourceKey === signal.key);
    if (!node || typeof signal.score !== "number") continue;
    const conf = signal.score >= 85 ? 0.92 : signal.score >= 70 ? 0.8 : 0.65;
    created.push(
      makeEvidence({
        nodeId: node.nodeId,
        signalType: signal.signalType,
        kind: "direct",
        opportunity: "elicited_incidental",
        score: clamp01(signal.score / 100),
        confidence: conf,
        impact: 0.5,
        source: "azure",
        domain: node.type === "GSE_GRAMMAR" ? "grammar" : "lo",
        usedForPromotion: true,
        targeted: false,
        reliability: signal.score >= 80 ? "high" : "medium",
        ageBand: input.ageBand,
        evidenceText: `${signal.key}:${Math.round(signal.score)}`,
        metadataJson: {
          checkId: signal.signalType,
          ruleVersion: EVIDENCE_RULE_VERSION,
        },
      })
    );
  }

  if (created.length === 0) {
    return { evidenceCount: 0, nodeOutcomes: [] as NodeMasteryOutcome[] };
  }

  const deduped = new Map<string, EvidenceDraft>();
  for (const row of created) {
    const key = `${row.nodeId}|${row.signalType}|${row.evidenceKind}`;
    const prev = deduped.get(key);
    if (!prev || row.weight > prev.weight) deduped.set(key, row);
  }
  const rows = Array.from(deduped.values());

  await prisma.attemptGseEvidence.createMany({
    data: rows.map((row) => ({
      attemptId: input.attemptId,
      studentId: input.studentId,
      nodeId: row.nodeId,
      signalType: row.signalType,
      evidenceKind: row.evidenceKind,
      opportunityType: row.opportunityType,
      score: row.score,
      confidence: row.confidence,
      impact: row.impact,
      weight: row.weight,
      source: row.source,
      domain: row.domain,
      usedForPromotion: row.usedForPromotion,
      targeted: row.targeted,
      activationImpact: row.activationImpact,
      evidenceText: row.evidenceText || null,
      metadataJson: ((row.metadataJson || {}) as Prisma.InputJsonValue),
    })),
  });

  const masteryEvidences: MasteryEvidence[] = rows.map((row) => ({
    nodeId: row.nodeId,
    confidence: row.confidence,
    impact: row.impact,
    reliability: row.reliability,
    evidenceKind: row.evidenceKind,
    opportunityType: row.opportunityType,
    score: row.score,
    weight: row.weight,
    usedForPromotion: row.usedForPromotion,
    taskType: input.taskType,
    targeted: row.targeted,
  }));

  const nodeOutcomes = await applyEvidenceToStudentMastery({
    studentId: input.studentId,
    evidences: masteryEvidences,
    calculationVersion: "gse-mastery-v2",
  });

  const impactByNode = new Map<string, EvidenceActivationImpact>();
  for (const outcome of nodeOutcomes) {
    if (outcome.activationImpact !== "none") {
      impactByNode.set(outcome.nodeId, outcome.activationImpact);
    }
  }
  for (const [nodeId, activationImpact] of impactByNode.entries()) {
    await prisma.attemptGseEvidence.updateMany({
      where: { attemptId: input.attemptId, nodeId },
      data: { activationImpact },
    });
  }

  const domainCounts = rows.reduce<Record<string, number>>((acc, row) => {
    const key = row.domain || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const topDelta = [...nodeOutcomes]
    .sort((a, b) => Math.abs(b.deltaMastery) - Math.abs(a.deltaMastery))
    .slice(0, 3)
    .map((item) => ({
      nodeId: item.nodeId,
      deltaMastery: item.deltaMastery,
      nextMean: item.nextMean,
      reliability: item.reliability,
    }));
  console.log(
    JSON.stringify({
      event: "node_update_applied",
      attemptId: input.attemptId,
      studentId: input.studentId,
      evidenceCount: rows.length,
      domainCounts,
      topDelta,
      consistency,
    })
  );
  if (consistency.inconsistent) {
    console.log(
      JSON.stringify({
        event: "evidence_consistency_repaired",
        attemptId: input.attemptId,
        studentId: input.studentId,
        taskType: input.taskType,
        reason: "low_task_score_missing_explicit_negative_lo",
      })
    );
  }

  return { evidenceCount: rows.length, nodeOutcomes };
}

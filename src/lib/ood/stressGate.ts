import { prisma } from "@/lib/db";
import type { CEFRStage } from "@/lib/curriculum";

const STAGE_ORDER: CEFRStage[] = ["A0", "A1", "A2", "B1", "B2", "C1", "C2"];

export const MILESTONE_STRESS_GATE_VERSION = "milestone-stress-gate-v1" as const;
export const MILESTONE_STRESS_GATE_WINDOW_DAYS = 45;
export const MILESTONE_STRESS_GATE_REQUIRED_PAIRWISE_COMBINATIONS = 2;
export const MILESTONE_STRESS_GATE_FLOOR_SCORE = 70;
const MILESTONE_STRESS_GATE_STAGE_FLOOR: CEFRStage = "B1";

type ProbeClassification = "pass" | "fail" | "inconclusive";

export type MilestoneStressProbeInput = {
  oodTaskSpecId: string;
  createdAt: Date;
  axisTags: string[];
  verdict: string | null;
  metadataJson: unknown;
};

export type MilestoneStressPairObservation = {
  pairKey: string;
  oodTaskSpecId: string;
  createdAt: string;
  axisTags: string[];
  verdict: string | null;
  oodTaskScore: number | null;
  classification: ProbeClassification;
};

export type MilestoneStressGateResult = {
  required: boolean;
  evaluated: boolean;
  passed: boolean;
  protocolVersion: typeof MILESTONE_STRESS_GATE_VERSION;
  targetStage: string;
  stageFloor: CEFRStage;
  windowDays: number;
  requiredPairwiseCombinations: number;
  floorScore: number;
  evaluatedProbeCount: number;
  multiAxisProbeCount: number;
  distinctPairwiseCombinationCount: number;
  stressSetPairCount: number;
  stressSetPassCount: number;
  stressSetFailCount: number;
  stressSetInconclusiveCount: number;
  worstCaseScore: number | null;
  observedPairwiseCombinations: string[];
  stressSetPairKeys: string[];
  pairObservations: MilestoneStressPairObservation[];
  stressSetObservations: MilestoneStressPairObservation[];
  reasonCodes: string[];
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number) {
  return Number(value.toFixed(4));
}

function asJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stageIndex(stage: string) {
  return STAGE_ORDER.indexOf(stage as CEFRStage);
}

function isStressGateRequired(targetStage: string) {
  const targetIndex = stageIndex(targetStage);
  if (targetIndex < 0) return false;
  return targetIndex >= stageIndex(MILESTONE_STRESS_GATE_STAGE_FLOOR);
}

function normalizeAxisTags(axisTags: string[]) {
  return [...new Set(axisTags.map((axis) => axis.trim().toLowerCase()).filter(Boolean))].sort();
}

function pairKeysFromAxisTags(axisTags: string[]) {
  const normalized = normalizeAxisTags(axisTags);
  if (normalized.length < 2) return [];
  const pairs: string[] = [];
  for (let i = 0; i < normalized.length; i += 1) {
    for (let j = i + 1; j < normalized.length; j += 1) {
      pairs.push(`${normalized[i]}+${normalized[j]}`);
    }
  }
  return pairs;
}

function classifyProbe(params: {
  verdict: string | null;
  oodTaskScore: number | null;
  floorScore: number;
}): ProbeClassification {
  const verdict = params.verdict || null;
  if (verdict === "transfer_pass" && typeof params.oodTaskScore === "number" && params.oodTaskScore >= params.floorScore) {
    return "pass";
  }
  if (verdict === "transfer_fail_validated") return "fail";
  if (verdict === "inconclusive_control_missing" || verdict === "inconclusive_missing_ood_score") return "fail";
  if (typeof params.oodTaskScore === "number" && params.oodTaskScore < params.floorScore) return "fail";
  return "inconclusive";
}

function parseStressProbe(input: MilestoneStressProbeInput, floorScore: number) {
  const metadata = asJsonObject(input.metadataJson);
  const transferVerdict = asJsonObject(metadata.transferVerdict);
  const oodTaskScore = toFiniteNumber(transferVerdict.oodTaskScore);
  const verdict =
    typeof input.verdict === "string" && input.verdict.trim().length > 0
      ? input.verdict.trim()
      : typeof transferVerdict.verdict === "string"
        ? transferVerdict.verdict
        : null;
  const axisTags = normalizeAxisTags(input.axisTags || []);
  const pairKeys = pairKeysFromAxisTags(axisTags);
  const classification = classifyProbe({ verdict, oodTaskScore, floorScore });
  return {
    ...input,
    axisTags,
    pairKeys,
    verdict,
    oodTaskScore,
    classification,
  };
}

export function evaluateMilestoneStressGate(params: {
  targetStage: string;
  probes: MilestoneStressProbeInput[];
  windowDays?: number;
  floorScore?: number;
  requiredPairwiseCombinations?: number;
}): MilestoneStressGateResult {
  const required = isStressGateRequired(params.targetStage);
  const floorScore = params.floorScore ?? MILESTONE_STRESS_GATE_FLOOR_SCORE;
  const requiredPairwiseCombinations = Math.max(
    1,
    Math.floor(params.requiredPairwiseCombinations ?? MILESTONE_STRESS_GATE_REQUIRED_PAIRWISE_COMBINATIONS)
  );
  const windowDays = clamp(
    Math.floor(params.windowDays ?? MILESTONE_STRESS_GATE_WINDOW_DAYS),
    1,
    365
  );
  const reasonCodes: string[] = [];

  if (!required) {
    return {
      required: false,
      evaluated: false,
      passed: true,
      protocolVersion: MILESTONE_STRESS_GATE_VERSION,
      targetStage: params.targetStage,
      stageFloor: MILESTONE_STRESS_GATE_STAGE_FLOOR,
      windowDays,
      requiredPairwiseCombinations,
      floorScore,
      evaluatedProbeCount: params.probes.length,
      multiAxisProbeCount: 0,
      distinctPairwiseCombinationCount: 0,
      stressSetPairCount: 0,
      stressSetPassCount: 0,
      stressSetFailCount: 0,
      stressSetInconclusiveCount: 0,
      worstCaseScore: null,
      observedPairwiseCombinations: [],
      stressSetPairKeys: [],
      pairObservations: [],
      stressSetObservations: [],
      reasonCodes: ["not_required_for_stage"],
    };
  }

  const parsed = params.probes
    .map((probe) => parseStressProbe(probe, floorScore))
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  const multiAxis = parsed.filter((probe) => probe.pairKeys.length > 0);

  const latestByPair = new Map<string, MilestoneStressPairObservation>();
  for (const probe of multiAxis) {
    for (const pairKey of probe.pairKeys) {
      if (latestByPair.has(pairKey)) continue;
      latestByPair.set(pairKey, {
        pairKey,
        oodTaskSpecId: probe.oodTaskSpecId,
        createdAt: probe.createdAt.toISOString(),
        axisTags: probe.axisTags,
        verdict: probe.verdict,
        oodTaskScore: probe.oodTaskScore,
        classification: probe.classification,
      });
    }
  }

  const pairObservations = [...latestByPair.values()].sort(
    (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  );
  const observedPairwiseCombinations = pairObservations.map((row) => row.pairKey).sort();
  const stressSetObservations = pairObservations.slice(0, requiredPairwiseCombinations);
  const stressSetPairKeys = stressSetObservations.map((row) => row.pairKey);

  const stressSetPassCount = stressSetObservations.filter((row) => row.classification === "pass").length;
  const stressSetFailCount = stressSetObservations.filter((row) => row.classification === "fail").length;
  const stressSetInconclusiveCount = stressSetObservations.filter(
    (row) => row.classification === "inconclusive"
  ).length;
  const stressSetScores = stressSetObservations
    .map((row) => row.oodTaskScore)
    .filter((value): value is number => typeof value === "number");
  const worstCaseScore =
    stressSetScores.length > 0 ? round(Math.min(...stressSetScores)) : null;

  if (multiAxis.length === 0) {
    reasonCodes.push("no_multi_axis_probes");
  }
  if (stressSetObservations.length < requiredPairwiseCombinations) {
    reasonCodes.push("insufficient_pairwise_combinations");
  }
  if (stressSetFailCount > 0) {
    reasonCodes.push("stress_probe_failed");
  }
  if (stressSetInconclusiveCount > 0) {
    reasonCodes.push("stress_probe_inconclusive");
  }
  if (typeof worstCaseScore === "number" && worstCaseScore < floorScore) {
    reasonCodes.push("worst_case_below_floor");
  }

  const passed =
    stressSetObservations.length >= requiredPairwiseCombinations &&
    stressSetFailCount === 0 &&
    stressSetInconclusiveCount === 0 &&
    typeof worstCaseScore === "number" &&
    worstCaseScore >= floorScore;
  if (passed) {
    reasonCodes.push("stress_gate_passed");
  }

  return {
    required: true,
    evaluated: true,
    passed,
    protocolVersion: MILESTONE_STRESS_GATE_VERSION,
    targetStage: params.targetStage,
    stageFloor: MILESTONE_STRESS_GATE_STAGE_FLOOR,
    windowDays,
    requiredPairwiseCombinations,
    floorScore,
    evaluatedProbeCount: parsed.length,
    multiAxisProbeCount: multiAxis.length,
    distinctPairwiseCombinationCount: pairObservations.length,
    stressSetPairCount: stressSetObservations.length,
    stressSetPassCount,
    stressSetFailCount,
    stressSetInconclusiveCount,
    worstCaseScore,
    observedPairwiseCombinations,
    stressSetPairKeys,
    pairObservations,
    stressSetObservations,
    reasonCodes,
  };
}

export async function evaluateStudentMilestoneStressGate(params: {
  studentId: string;
  targetStage: string;
  now?: Date;
  windowDays?: number;
  floorScore?: number;
  requiredPairwiseCombinations?: number;
  limit?: number;
}): Promise<MilestoneStressGateResult> {
  const windowDays = clamp(
    Math.floor(params.windowDays ?? MILESTONE_STRESS_GATE_WINDOW_DAYS),
    1,
    365
  );
  const now = params.now || new Date();
  const since = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const limit = clamp(Math.floor(params.limit ?? 400), 20, 5000);

  const probes = await prisma.oODTaskSpec.findMany({
    where: {
      studentId: params.studentId,
      createdAt: { gte: since, lte: now },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      createdAt: true,
      axisTags: true,
      verdict: true,
      metadataJson: true,
    },
  });

  return evaluateMilestoneStressGate({
    targetStage: params.targetStage,
    probes: probes.map((row) => ({
      oodTaskSpecId: row.id,
      createdAt: row.createdAt,
      axisTags: row.axisTags,
      verdict: row.verdict,
      metadataJson: row.metadataJson,
    })),
    windowDays,
    floorScore: params.floorScore,
    requiredPairwiseCombinations: params.requiredPairwiseCombinations,
  });
}

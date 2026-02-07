import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { CEFRStage, SkillKey } from "@/lib/curriculum";
import { mapStageToGseRange } from "./utils";

const STAGE_ORDER: CEFRStage[] = ["A0", "A1", "A2", "B1", "B2", "C1", "C2"];
const PROMOTION_COVERAGE_THRESHOLD = 0.62;
const PROMOTION_RELIABILITY_THRESHOLD = 0.6;
const PROMOTION_MIN_ROWS = 6;

type StageBandStats = {
  stage: CEFRStage;
  total: number;
  covered70: number;
  coverage70: number | null;
  reliabilityRatio: number | null;
  blockers: Array<{ nodeId: string; descriptor: string; value: number }>;
};

type DerivedSkill = {
  skillKey: SkillKey;
  current: number | null;
  reliability: "high" | "medium" | "low";
  sampleCount: number;
  source: "gse-derived";
};

export type StageProjection = {
  stage: CEFRStage;
  confidence: number;
  score: number;
  source: "gse_projection";
  currentStageStats: StageBandStats;
  targetStage: CEFRStage;
  targetStageStats: StageBandStats;
  promotionReady: boolean;
  blockedByNodes: string[];
  blockedByNodeDescriptors: string[];
  nodeCoverageByBand: Record<string, { mastered: number; total: number }>;
  derivedSkills: DerivedSkill[];
};

type MasteryRow = {
  nodeId: string;
  masteryScore: number;
  masteryMean: number | null;
  masterySigma: number | null;
  decayedMastery: number | null;
  reliability: string;
  evidenceCount: number;
  node: {
    descriptor: string;
    gseCenter: number | null;
    type: string;
    skill: string | null;
  };
};

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function toStageIndex(stage: CEFRStage) {
  const idx = STAGE_ORDER.indexOf(stage);
  return idx === -1 ? 0 : idx;
}

function stageAt(index: number): CEFRStage {
  const i = Math.max(0, Math.min(STAGE_ORDER.length - 1, index));
  return STAGE_ORDER[i];
}

function nextStage(stage: CEFRStage): CEFRStage {
  return stageAt(toStageIndex(stage) + 1);
}

function scoreValue(row: MasteryRow) {
  return row.decayedMastery ?? row.masteryMean ?? row.masteryScore;
}

function gseBandFromCenter(value: number | null | undefined): CEFRStage {
  if (typeof value !== "number") return "A0";
  if (value <= 29) return "A1";
  if (value <= 42) return "A2";
  if (value <= 58) return "B1";
  if (value <= 75) return "B2";
  if (value <= 84) return "C1";
  return "C2";
}

function buildStageStats(rows: MasteryRow[], stage: CEFRStage): StageBandStats {
  const range = mapStageToGseRange(stage);
  const inBand = rows.filter((row) => {
    const g = row.node.gseCenter;
    return typeof g === "number" && g >= range.min && g <= range.max;
  });
  const covered = inBand.filter((row) => scoreValue(row) >= 70).length;
  const nonLow = inBand.filter((row) => row.reliability !== "low").length;
  const blockers = inBand
    .filter((row) => scoreValue(row) < 60)
    .sort((a, b) => scoreValue(a) - scoreValue(b))
    .slice(0, 8)
    .map((row) => ({
      nodeId: row.nodeId,
      descriptor: row.node.descriptor,
      value: Number(scoreValue(row).toFixed(2)),
    }));
  return {
    stage,
    total: inBand.length,
    covered70: covered,
    coverage70: inBand.length > 0 ? Number((covered / inBand.length).toFixed(4)) : null,
    reliabilityRatio: inBand.length > 0 ? Number((nonLow / inBand.length).toFixed(4)) : null,
    blockers,
  };
}

function confidenceFromRows(rows: MasteryRow[]) {
  if (rows.length === 0) return 0.35;
  const sigmaValues = rows
    .map((row) => row.masterySigma)
    .filter((value): value is number => typeof value === "number");
  const sigmaAvg = sigmaValues.length
    ? sigmaValues.reduce((sum, value) => sum + value, 0) / sigmaValues.length
    : 24;
  const sigmaComponent = clamp(1 - (sigmaAvg - 6) / 28, 0, 1);
  const evidenceVolume = clamp(rows.filter((row) => row.evidenceCount > 0).length / 40, 0, 1);
  const reliabilityComponent = rows.filter((row) => row.reliability !== "low").length / rows.length;
  const confidence = 0.35 + sigmaComponent * 0.35 + evidenceVolume * 0.2 + reliabilityComponent * 0.1;
  return Number(clamp(confidence, 0.2, 0.99).toFixed(2));
}

function deriveSkillBuckets(rows: MasteryRow[]) {
  const byKey: Record<SkillKey, MasteryRow[]> = {
    pronunciation: [],
    fluency: [],
    tempo_control: [],
    vocabulary: [],
    task_completion: [],
  };

  for (const row of rows) {
    const descriptor = row.node.descriptor.toLowerCase();
    const nodeSkill = row.node.skill || "";
    const isVocab = row.node.type === "GSE_VOCAB" || nodeSkill === "vocabulary";
    const isGrammar = row.node.type === "GSE_GRAMMAR" || nodeSkill === "grammar";

    if (isVocab) {
      byKey.vocabulary.push(row);
      continue;
    }
    if (descriptor.includes("pronunciation") || descriptor.includes("pronounce")) {
      byKey.pronunciation.push(row);
      continue;
    }
    if (descriptor.includes("fluency") || descriptor.includes("smooth")) {
      byKey.fluency.push(row);
      continue;
    }
    if (descriptor.includes("pace") || descriptor.includes("pause") || descriptor.includes("tempo")) {
      byKey.tempo_control.push(row);
      continue;
    }
    if (isGrammar) {
      byKey.task_completion.push(row);
      continue;
    }
    if (nodeSkill === "speaking" || nodeSkill === "writing" || nodeSkill === "listening") {
      byKey.task_completion.push(row);
      byKey.fluency.push(row);
    }
  }

  return byKey;
}

function reliabilityFromRows(rows: MasteryRow[]): "high" | "medium" | "low" {
  if (rows.some((row) => row.reliability === "high")) return "high";
  if (rows.some((row) => row.reliability === "medium")) return "medium";
  return "low";
}

function buildDerivedSkills(rows: MasteryRow[]): DerivedSkill[] {
  const buckets = deriveSkillBuckets(rows);
  return (Object.keys(buckets) as SkillKey[]).map((skillKey) => {
    const list = buckets[skillKey];
    if (list.length === 0) {
      return {
        skillKey,
        current: null,
        reliability: "low",
        sampleCount: 0,
        source: "gse-derived",
      };
    }
    const value = list.reduce((sum, row) => sum + scoreValue(row), 0) / list.length;
    return {
      skillKey,
      current: Number(value.toFixed(2)),
      reliability: reliabilityFromRows(list),
      sampleCount: list.reduce((sum, row) => sum + Math.max(1, row.evidenceCount), 0),
      source: "gse-derived",
    };
  });
}

function buildNodeCoverageByBand(rows: MasteryRow[]) {
  return rows.reduce<Record<string, { mastered: number; total: number }>>((acc, row) => {
    const band = gseBandFromCenter(row.node.gseCenter);
    if (!acc[band]) acc[band] = { mastered: 0, total: 0 };
    acc[band].total += 1;
    if (scoreValue(row) >= 75) acc[band].mastered += 1;
    return acc;
  }, {});
}

function projectStage(rows: MasteryRow[]) {
  let stage: CEFRStage = "A0";
  for (const candidate of STAGE_ORDER.slice(1)) {
    const stats = buildStageStats(rows, candidate);
    const coverageOk = (stats.coverage70 ?? 0) >= PROMOTION_COVERAGE_THRESHOLD;
    const reliabilityOk = (stats.reliabilityRatio ?? 0) >= PROMOTION_RELIABILITY_THRESHOLD;
    const sampleOk = stats.total >= PROMOTION_MIN_ROWS;
    if (!coverageOk || !reliabilityOk || !sampleOk) break;
    stage = candidate;
  }
  return stage;
}

export async function projectLearnerStageFromGse(studentId: string): Promise<StageProjection> {
  const rows = await prisma.studentGseMastery.findMany({
    where: { studentId },
    include: {
      node: {
        select: {
          descriptor: true,
          gseCenter: true,
          type: true,
          skill: true,
        },
      },
    },
    orderBy: [{ updatedAt: "desc" }],
    take: 2500,
  });

  const stage = projectStage(rows);
  const targetStage = nextStage(stage);
  const currentStats = buildStageStats(rows, stage === "A0" ? "A1" : stage);
  const targetStats = buildStageStats(rows, targetStage);
  const promotionReady =
    toStageIndex(targetStage) === toStageIndex(stage) ||
    ((targetStats.coverage70 ?? 0) >= PROMOTION_COVERAGE_THRESHOLD &&
      (targetStats.reliabilityRatio ?? 0) >= PROMOTION_RELIABILITY_THRESHOLD &&
      targetStats.total >= PROMOTION_MIN_ROWS);
  const blockedByNodes = targetStats.blockers.map((item) => item.nodeId);
  const blockedByNodeDescriptors = targetStats.blockers.map((item) => item.descriptor);
  const confidence = confidenceFromRows(rows);
  const score = Number(
    (
      (targetStats.coverage70 ?? currentStats.coverage70 ?? 0) * 60 +
      ((targetStats.reliabilityRatio ?? currentStats.reliabilityRatio ?? 0) >= PROMOTION_RELIABILITY_THRESHOLD
        ? 25
        : 10) +
      Math.min(15, Math.round(confidence * 15))
    ).toFixed(1)
  );

  return {
    stage,
    confidence,
    score: clamp(score),
    source: "gse_projection",
    currentStageStats: currentStats,
    targetStage,
    targetStageStats: targetStats,
    promotionReady,
    blockedByNodes,
    blockedByNodeDescriptors,
    nodeCoverageByBand: buildNodeCoverageByBand(rows),
    derivedSkills: buildDerivedSkills(rows),
  };
}

export async function refreshLearnerProfileFromGse(params: {
  studentId: string;
  reason: string;
  placementFresh?: boolean;
  uncertainNodeIds?: string[];
  carryoverSummary?: Prisma.InputJsonValue;
}) {
  const projection = await projectLearnerStageFromGse(params.studentId);
  await prisma.learnerProfile.upsert({
    where: { studentId: params.studentId },
    update: {
      stage: projection.stage,
      stageSource: "gse_projection",
      stageEvidenceJson: {
        reason: params.reason,
        projectionScore: projection.score,
        confidence: projection.confidence,
        currentStageStats: projection.currentStageStats,
        targetStageStats: projection.targetStageStats,
      },
      placementScore: projection.score,
      placementConfidence: projection.confidence,
      placementFresh:
        typeof params.placementFresh === "boolean" ? params.placementFresh : undefined,
      placementUncertainNodeIds: params.uncertainNodeIds ?? undefined,
      placementCarryoverJson: params.carryoverSummary ?? undefined,
    },
    create: {
      studentId: params.studentId,
      stage: projection.stage,
      stageSource: "gse_projection",
      stageEvidenceJson: {
        reason: params.reason,
        projectionScore: projection.score,
        confidence: projection.confidence,
        currentStageStats: projection.currentStageStats,
        targetStageStats: projection.targetStageStats,
      },
      placementScore: projection.score,
      placementConfidence: projection.confidence,
      placementFresh: Boolean(params.placementFresh),
      placementUncertainNodeIds: params.uncertainNodeIds || [],
      placementCarryoverJson: params.carryoverSummary ?? Prisma.DbNull,
      ageBand: "9-11",
      activeTrack: "balanced_convo_speech",
      cycleWeek: 1,
    },
  });

  await prisma.gseStageProjection.create({
    data: {
      studentId: params.studentId,
      stage: projection.stage,
      confidence: projection.confidence,
      stageScore: projection.score,
      source: "gse_projection",
      reason: params.reason,
      evidenceJson: {
        currentStageStats: projection.currentStageStats,
        targetStageStats: projection.targetStageStats,
        blockedByNodes: projection.blockedByNodes,
      },
    },
  });

  return projection;
}

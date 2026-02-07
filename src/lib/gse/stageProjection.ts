import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { CEFRStage, SkillKey } from "@/lib/curriculum";
import { computeStageBundleReadiness } from "./bundles";

const STAGE_ORDER: CEFRStage[] = ["A0", "A1", "A2", "B1", "B2", "C1", "C2"];
const RELIABILITY_THRESHOLD = 0.65;

type StageBandStats = {
  stage: CEFRStage;
  total: number;
  covered70: number;
  coverage70: number | null;
  reliabilityRatio: number | null;
  uncertaintyAvg: number | null;
  directEvidenceSum: number;
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
  placementStage: CEFRStage;
  placementConfidence: number;
  placementUncertainty: number;
  promotionStage: CEFRStage;
  promotionReady: boolean;
  currentStageStats: StageBandStats;
  targetStage: CEFRStage;
  targetStageStats: StageBandStats;
  blockedByNodes: string[];
  blockedByNodeDescriptors: string[];
  blockedBundles: Array<{
    bundleKey: string;
    title: string;
    domain: "vocab" | "grammar" | "lo";
    reason: string;
    blockers: Array<{ nodeId: string; descriptor: string; value: number }>;
  }>;
  /** Per-bundle achieved count for target stage (X/Y nodes at 70+ verified). */
  targetStageBundleProgress: Array<{
    bundleKey: string;
    title: string;
    domain: string;
    coveredCount: number;
    totalRequired: number;
    ready: boolean;
  }>;
  /** 0..1: value-weighted progress toward 70 for target stage nodes (min(value,70)/70). Used so progress bar moves with every evidence. */
  targetStageValueProgress: number;
  nodeCoverageByBand: Record<string, { mastered: number; total: number }>;
  derivedSkills: DerivedSkill[];
};

type MasteryRow = {
  nodeId: string;
  masteryScore: number;
  masteryMean: number | null;
  masterySigma: number | null;
  uncertainty: number | null;
  decayedMastery: number | null;
  reliability: string;
  evidenceCount: number;
  directEvidenceCount: number;
  updatedAt: Date;
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

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
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

function rowUncertainty(row: MasteryRow) {
  if (typeof row.uncertainty === "number" && Number.isFinite(row.uncertainty)) {
    return clamp01(row.uncertainty);
  }
  const sigma = typeof row.masterySigma === "number" ? row.masterySigma : 24;
  return clamp01(sigma / 100);
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

function projectPromotionStageFromBundles(stageRows: Array<{
  stage: CEFRStage;
  ready: boolean;
}>) {
  let stage: CEFRStage = "A0";
  for (const candidate of STAGE_ORDER.slice(1)) {
    const row = stageRows.find((item) => item.stage === candidate);
    if (!row || !row.ready) break;
    stage = candidate;
  }
  return stage;
}

function projectPlacementStage(rows: MasteryRow[]) {
  const usable = rows.filter((row) => row.evidenceCount > 0 && typeof row.node.gseCenter === "number");
  if (usable.length === 0) {
    return {
      stage: "A0" as CEFRStage,
      confidence: 0.35,
      uncertainty: 0.95,
    };
  }

  const weighted = usable.map((row) => {
    const reliability = row.reliability === "high" ? 1 : row.reliability === "medium" ? 0.8 : 0.6;
    const evidenceBoost = Math.min(2.2, 1 + Math.log2(Math.max(1, row.evidenceCount + 1)) * 0.45);
    const masteryBoost = clamp01(scoreValue(row) / 100);
    const w = reliability * evidenceBoost * Math.max(0.35, masteryBoost);
    return {
      center: row.node.gseCenter as number,
      weight: w,
      uncertainty: rowUncertainty(row),
    };
  });

  const sumWeight = weighted.reduce((sum, row) => sum + row.weight, 0) || 1;
  const center = weighted.reduce((sum, row) => sum + row.center * row.weight, 0) / sumWeight;
  const uncertainty = weighted.reduce((sum, row) => sum + row.uncertainty * row.weight, 0) / sumWeight;
  const stage = gseBandFromCenter(center);
  const confidence = Number(clamp(1 - uncertainty, 0.2, 0.98).toFixed(2));

  return {
    stage,
    confidence,
    uncertainty: Number(uncertainty.toFixed(4)),
  };
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

  const placement = projectPlacementStage(rows);
  const bundleReadiness = await computeStageBundleReadiness(studentId, placement.stage);
  const bundlePromotionStage = projectPromotionStageFromBundles(bundleReadiness.stageRows);
  // If placement is above bundle-based promotion, lift promotion: learner shows skills from higher
  // nodes → treat as that level so we don't show "A0" while they're working on B1.
  const placementIdx = toStageIndex(placement.stage);
  const bundlePromoIdx = toStageIndex(bundlePromotionStage);
  const promotionStage: CEFRStage =
    placementIdx > bundlePromoIdx ? placement.stage : bundlePromotionStage;
  const targetStage = nextStage(promotionStage);
  const currentStageRow = bundleReadiness.stageRows.find(
    (row) => row.stage === (promotionStage === "A0" ? "A1" : promotionStage)
  );
  const targetStageRow = bundleReadiness.stageRows.find((row) => row.stage === targetStage);
  const toStats = (stage: CEFRStage, row?: (typeof bundleReadiness.stageRows)[number]): StageBandStats => ({
    stage,
    total: row?.bundleRows.reduce((sum, item) => sum + item.totalRequired, 0) || 0,
    covered70: row?.bundleRows.reduce((sum, item) => sum + item.coveredCount, 0) || 0,
    coverage70:
      row && row.bundleRows.length > 0
        ? Number(
            (
              row.bundleRows.reduce((sum, item) => sum + item.coveredCount, 0) /
              Math.max(1, row.bundleRows.reduce((sum, item) => sum + item.totalRequired, 0))
            ).toFixed(4)
          )
        : null,
    reliabilityRatio: row ? Number(row.reliability.toFixed(4)) : null,
    uncertaintyAvg:
      row && row.bundleRows.length > 0
        ? Number(
            (
              row.bundleRows.reduce((sum, item) => sum + item.uncertaintyAvg, 0) /
              row.bundleRows.length
            ).toFixed(4)
          )
        : null,
    directEvidenceSum: row?.bundleRows.reduce((sum, item) => sum + item.directEvidenceCovered, 0) || 0,
    blockers:
      row?.blockedBundles
        .flatMap((bundle) => bundle.blockers)
        .filter((value, index, arr) => arr.findIndex((x) => x.nodeId === value.nodeId) === index)
        .slice(0, 8) || [],
  });
  const currentStats = toStats(promotionStage === "A0" ? "A1" : promotionStage, currentStageRow);
  const targetStats = toStats(targetStage, targetStageRow);
  const promotionReady =
    toStageIndex(targetStage) === toStageIndex(promotionStage) ||
    Boolean(targetStageRow?.ready);

  const blockedBundles = targetStageRow?.blockedBundles || [];
  const blockedByNodes = blockedBundles.flatMap((bundle) => bundle.blockers.map((item) => item.nodeId));
  const blockedByNodeDescriptors = blockedBundles.flatMap((bundle) =>
    bundle.blockers.map((item) => item.descriptor)
  );
  const confidence = confidenceFromRows(rows);
  const score = Number(
    (
      (targetStageRow?.coverage ?? targetStats.coverage70 ?? currentStats.coverage70 ?? 0) * 60 +
      ((targetStageRow?.reliability ?? targetStats.reliabilityRatio ?? currentStats.reliabilityRatio ?? 0) >= RELIABILITY_THRESHOLD
        ? 20
        : 8) +
      ((targetStageRow?.stability ?? 0) >= 0.5
        ? 10
        : 3) +
      Math.min(10, Math.round(confidence * 10))
    ).toFixed(1)
  );

  const targetStageBundleProgress = (targetStageRow?.bundleRows ?? []).map((row) => ({
    bundleKey: row.bundleKey,
    title: row.title,
    domain: row.domain,
    coveredCount: row.coveredCount,
    totalRequired: row.totalRequired,
    ready: row.ready,
  }));

  const targetStageValueProgress =
    (targetStageRow?.bundleRows ?? []).length > 0
      ? Number(
          (
            (targetStageRow!.bundleRows.reduce(
              (sum, row) => sum + row.valueProgress * row.totalRequired,
              0
            ) as number) /
            Math.max(1, (targetStageRow!.bundleRows.reduce((s, row) => s + row.totalRequired, 0) as number))
          ).toFixed(4)
        )
      : 0;

  return {
    stage: promotionStage,
    confidence,
    score: clamp(score),
    source: "gse_projection",
    placementStage: placement.stage,
    placementConfidence: placement.confidence,
    placementUncertainty: placement.uncertainty,
    promotionStage,
    promotionReady,
    currentStageStats: currentStats,
    targetStage,
    targetStageStats: targetStats,
    blockedByNodes,
    blockedByNodeDescriptors,
    blockedBundles,
    targetStageBundleProgress,
    targetStageValueProgress,
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
  if (projection.blockedBundles.length > 0) {
    console.log(
      JSON.stringify({
        event: "promotion_blocked_bundle",
        studentId: params.studentId,
        reason: params.reason,
        promotionStage: projection.promotionStage,
        targetStage: projection.targetStage,
        blockedBundles: projection.blockedBundles.map((bundle) => ({
          bundleKey: bundle.bundleKey,
          domain: bundle.domain,
          reason: bundle.reason,
          blockerCount: bundle.blockers.length,
        })),
      })
    );
  }
  await prisma.learnerProfile.upsert({
    where: { studentId: params.studentId },
    update: {
      stage: projection.promotionStage,
      stageSource: "gse_projection",
      stageEvidenceJson: {
        reason: params.reason,
        projectionScore: projection.score,
        confidence: projection.confidence,
        placementStage: projection.placementStage,
        placementConfidence: projection.placementConfidence,
        placementUncertainty: projection.placementUncertainty,
        promotionStage: projection.promotionStage,
        currentStageStats: projection.currentStageStats,
        targetStageStats: projection.targetStageStats,
      },
      placementScore: projection.score,
      placementConfidence: projection.placementConfidence,
      placementFresh:
        typeof params.placementFresh === "boolean" ? params.placementFresh : undefined,
      placementUncertainNodeIds: params.uncertainNodeIds ?? undefined,
      placementCarryoverJson: params.carryoverSummary ?? undefined,
    },
    create: {
      studentId: params.studentId,
      stage: projection.promotionStage,
      stageSource: "gse_projection",
      stageEvidenceJson: {
        reason: params.reason,
        projectionScore: projection.score,
        confidence: projection.confidence,
        placementStage: projection.placementStage,
        placementConfidence: projection.placementConfidence,
        placementUncertainty: projection.placementUncertainty,
        promotionStage: projection.promotionStage,
        currentStageStats: projection.currentStageStats,
        targetStageStats: projection.targetStageStats,
      },
      placementScore: projection.score,
      placementConfidence: projection.placementConfidence,
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
      stage: projection.promotionStage,
      confidence: projection.confidence,
      stageScore: projection.score,
      source: "gse_projection",
      reason: params.reason,
      evidenceJson: {
        placementStage: projection.placementStage,
        placementConfidence: projection.placementConfidence,
        placementUncertainty: projection.placementUncertainty,
        promotionStage: projection.promotionStage,
        currentStageStats: projection.currentStageStats,
        targetStageStats: projection.targetStageStats,
        blockedByNodes: projection.blockedByNodes,
        blockedBundles: projection.blockedBundles,
      },
    },
  });

  return projection;
}

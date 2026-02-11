import { prisma } from "@/lib/db";
import { CEFRStage } from "@/lib/curriculum";
import { mapStageToGseRange } from "./utils";

const STAGES: CEFRStage[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
const DOMAINS = ["vocab", "grammar", "lo"] as const;
type BundleDomain = (typeof DOMAINS)[number];

const PROMOTION_COVERAGE_BY_STAGE: Record<CEFRStage, number> = {
  A0: 0.5,
  A1: 0.55,
  A2: 0.6,
  B1: 0.65,
  B2: 0.7,
  C1: 0.75,
  C2: 0.78,
};

const MIN_DIRECT_BY_STAGE: Record<CEFRStage, number> = {
  A0: 8,
  A1: 12,
  A2: 12,
  B1: 20,
  B2: 20,
  C1: 24,
  C2: 28,
};

function nodeTypeForDomain(domain: BundleDomain) {
  if (domain === "vocab") return "GSE_VOCAB";
  if (domain === "grammar") return "GSE_GRAMMAR";
  return "GSE_LO";
}

function bundleTitle(stage: CEFRStage, domain: BundleDomain) {
  if (domain === "vocab") return `${stage} Vocabulary Core`;
  if (domain === "grammar") return `${stage} Grammar Core`;
  return `${stage} Can-Do Core`;
}

function maxNodesFor(stage: CEFRStage, domain: BundleDomain) {
  if (domain === "grammar") return stage === "A1" ? 12 : stage === "A2" ? 14 : 18;
  if (domain === "vocab") return stage === "A1" ? 16 : stage === "A2" ? 20 : 24;
  return stage === "A1" ? 14 : stage === "A2" ? 16 : 20;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

export type BundleReadinessRow = {
  bundleId: string;
  bundleKey: string;
  title: string;
  stage: CEFRStage;
  domain: BundleDomain;
  totalRequired: number;
  requiredCoverage: number;
  coveredCount: number;
  coverage: number;
  /** 0..1: average progress toward 70 per required node (min(value,70)/70). Makes progress bar move with every evidence. */
  valueProgress: number;
  directEvidenceCovered: number;
  reliabilityRatio: number;
  stabilityRatio: number;
  uncertaintyAvg: number;
  ready: boolean;
  blockers: Array<{ nodeId: string; descriptor: string; value: number }>;
  /** Nodes that count as credited (70+ and verified, or placement above + value≥50 + direct). */
  achieved: Array<{ nodeId: string; descriptor: string; value: number }>;
};

export type StageBundleReadiness = {
  stage: CEFRStage;
  ready: boolean;
  coverage: number;
  reliability: number;
  stability: number;
  blockedBundles: Array<{
    bundleKey: string;
    title: string;
    domain: BundleDomain;
    reason: string;
    blockers: Array<{ nodeId: string; descriptor: string; value: number }>;
  }>;
  bundleRows: BundleReadinessRow[];
};

/** Node IDs from all bundles for a given stage (for planner: prefer these to align tasks with progress). */
export async function getBundleNodeIdsForStage(stage: CEFRStage): Promise<string[]> {
  await ensureDefaultGseBundles();
  const bundles = await prisma.gseBundle.findMany({
    where: { active: true, stage },
    include: { nodes: { select: { nodeId: true } } },
  });
  return dedupe(bundles.flatMap((b) => b.nodes.map((n) => n.nodeId)));
}

/** Node IDs from bundles for a given stage AND domain (required nodes only). */
export async function getBundleNodeIdsForStageAndDomain(stage: CEFRStage, domain: BundleDomain): Promise<string[]> {
  await ensureDefaultGseBundles();
  const bundles = await prisma.gseBundle.findMany({
    where: { active: true, stage, domain },
    include: { nodes: { where: { required: true }, select: { nodeId: true } } },
  });
  return dedupe(bundles.flatMap((b) => b.nodes.map((n) => n.nodeId)));
}

function dedupe<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

export async function ensureDefaultGseBundles() {
  const existingCount = await prisma.gseBundle.count({ where: { active: true } });
  if (existingCount >= STAGES.length * DOMAINS.length) return;

  for (const stage of STAGES) {
    const range = mapStageToGseRange(stage);
    for (const domain of DOMAINS) {
      const key = `stage:${stage}:domain:${domain}`;
      const requiredCoverage = PROMOTION_COVERAGE_BY_STAGE[stage];
      const minDirectEvidence = MIN_DIRECT_BY_STAGE[stage];
      const bundle = await prisma.gseBundle.upsert({
        where: { key },
        update: {
          stage,
          domain,
          title: bundleTitle(stage, domain),
          requiredCoverage,
          minDirectEvidence,
          reliabilityGate: 0.65,
          active: true,
        },
        create: {
          key,
          stage,
          domain,
          title: bundleTitle(stage, domain),
          requiredCoverage,
          minDirectEvidence,
          reliabilityGate: 0.65,
          active: true,
          metadataJson: {
            source: "bootstrap",
            stage,
            domain,
          },
        },
      });

      const already = await prisma.gseBundleNode.count({ where: { bundleId: bundle.id } });
      if (already > 0) continue;

      const candidates = await prisma.gseNode.findMany({
        where: {
          type: nodeTypeForDomain(domain),
          gseCenter: { gte: range.min, lte: range.max },
        },
        orderBy: [{ gseCenter: "asc" }, { updatedAt: "desc" }],
        take: maxNodesFor(stage, domain),
        select: { nodeId: true },
      });
      if (candidates.length === 0) continue;

      await prisma.gseBundleNode.createMany({
        data: candidates.map((node, index) => ({
          bundleId: bundle.id,
          nodeId: node.nodeId,
          required: true,
          weight: index < Math.max(6, Math.ceil(candidates.length * 0.5)) ? 1 : 0.7,
        })),
        skipDuplicates: true,
      });
    }
  }
}

const STAGE_ORDER_FULL: CEFRStage[] = ["A0", "A1", "A2", "B1", "B2", "C1", "C2"];
/** True when placement has passed the given stage (used for bundle credited: value≥50+direct counts only when placement above stage). */
export function isPlacementAboveStage(placementStage: CEFRStage | undefined, bundleStage: CEFRStage): boolean {
  if (!placementStage) return false;
  const pIdx = STAGE_ORDER_FULL.indexOf(placementStage);
  const bIdx = STAGE_ORDER_FULL.indexOf(bundleStage);
  return pIdx >= 0 && bIdx >= 0 && pIdx > bIdx;
}

export async function computeStageBundleReadiness(studentId: string, placementStage?: CEFRStage) {
  await ensureDefaultGseBundles();

  const bundles = await prisma.gseBundle.findMany({
    where: { active: true },
    include: {
      nodes: {
        include: {
          node: {
            select: { nodeId: true, descriptor: true },
          },
        },
      },
    },
    orderBy: [{ stage: "asc" }, { domain: "asc" }],
  });

  const nodeIds = Array.from(new Set(bundles.flatMap((bundle) => bundle.nodes.map((row) => row.nodeId))));
  const masteryRows = await prisma.studentGseMastery.findMany({
    where: {
      studentId,
      nodeId: { in: nodeIds.length > 0 ? nodeIds : ["__none__"] },
    },
    select: {
      nodeId: true,
      masteryScore: true,
      masteryMean: true,
      decayedMastery: true,
      reliability: true,
      uncertainty: true,
      masterySigma: true,
      directEvidenceCount: true,
      activationState: true,
      lastEvidenceAt: true,
    },
  });
  const byNode = new Map(masteryRows.map((row) => [row.nodeId, row]));
  const stableSince = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

  const rows: BundleReadinessRow[] = bundles.map((bundle) => {
    const requiredNodes = bundle.nodes.filter((row) => row.required);
    const totalRequired = requiredNodes.length;
    const scored = requiredNodes.map((row) => {
      const mastery = byNode.get(row.nodeId);
      const value = mastery
        ? (mastery.decayedMastery ?? mastery.masteryMean ?? mastery.masteryScore)
        : 0;
      const reliability = mastery?.reliability || "low";
      const uncertainty =
        typeof mastery?.uncertainty === "number"
          ? mastery.uncertainty
          : typeof mastery?.masterySigma === "number"
          ? Math.max(0, Math.min(1, mastery.masterySigma / 100))
          : 1;
      const direct = mastery?.directEvidenceCount || 0;
      const verified = mastery?.activationState === "verified";
      const stable = Boolean(mastery?.lastEvidenceAt && mastery.lastEvidenceAt >= stableSince && uncertainty <= 0.32);
      return {
        nodeId: row.nodeId,
        descriptor: row.node.descriptor,
        value,
        reliability,
        uncertainty,
        direct,
        verified,
        stable,
      };
    });

    // Fast credit: when placement is above this bundle's stage, count node as covered if value≥50 and ≥1 direct (no need to grind to verified+70)
    const placementAbove = isPlacementAboveStage(placementStage, bundle.stage as CEFRStage);
    const isCredited = (row: (typeof scored)[0]) =>
      (row.verified && row.value >= 70) || (placementAbove && row.value >= 50 && row.direct >= 1);
    const achievedRows = scored.filter(isCredited).sort((a, b) => b.value - a.value);
    const coveredCount = achievedRows.length;
    const coverage = totalRequired > 0 ? coveredCount / totalRequired : 0;
    const valueProgress =
      totalRequired > 0
        ? scored.reduce((sum, row) => sum + Math.min(1, Math.max(0, row.value / 70)), 0) / totalRequired
        : 0;
    const directEvidenceCovered = scored.filter((row) => row.verified && row.direct > 0 && row.value >= 65).length;
    const reliabilityRatio =
      totalRequired > 0 ? scored.filter((row) => row.verified && row.reliability !== "low").length / totalRequired : 0;
    const stabilityRatio = totalRequired > 0 ? scored.filter((row) => row.verified && row.stable).length / totalRequired : 0;
    const uncertaintyAvg =
      totalRequired > 0
        ? scored.reduce((sum, row) => sum + row.uncertainty, 0) / totalRequired
        : 1;

    const minDirect = Math.min(bundle.minDirectEvidence, totalRequired);
    const ready =
      coverage >= bundle.requiredCoverage &&
      reliabilityRatio >= bundle.reliabilityGate &&
      stabilityRatio >= 0.5 &&
      directEvidenceCovered >= minDirect;

    return {
      bundleId: bundle.id,
      bundleKey: bundle.key,
      title: bundle.title,
      stage: bundle.stage as CEFRStage,
      domain: bundle.domain as BundleDomain,
      totalRequired,
      requiredCoverage: bundle.requiredCoverage,
      coveredCount,
      coverage: Number(clamp01(coverage).toFixed(4)),
      valueProgress: Number(clamp01(valueProgress).toFixed(4)),
      directEvidenceCovered,
      reliabilityRatio: Number(clamp01(reliabilityRatio).toFixed(4)),
      stabilityRatio: Number(clamp01(stabilityRatio).toFixed(4)),
      uncertaintyAvg: Number(clamp01(uncertaintyAvg).toFixed(4)),
      ready,
      blockers: scored
        .filter((row) => !isCredited(row))
        .sort((a, b) => a.value - b.value)
        .slice(0, 20)
        .map((row) => ({
          nodeId: row.nodeId,
          descriptor: row.descriptor,
          value: Number(row.value.toFixed(2)),
        })),
      achieved: achievedRows.map((row) => ({
        nodeId: row.nodeId,
        descriptor: row.descriptor,
        value: Number(row.value.toFixed(2)),
      })),
    };
  });

  const grouped = new Map<CEFRStage, BundleReadinessRow[]>();
  for (const row of rows) {
    const stageRows = grouped.get(row.stage) || [];
    stageRows.push(row);
    grouped.set(row.stage, stageRows);
  }

  const stageRows: StageBundleReadiness[] = STAGES.map((stage) => {
    const bundleRows = grouped.get(stage) || [];
    const coverage =
      bundleRows.length > 0
        ? bundleRows.reduce((sum, row) => sum + row.coverage, 0) / bundleRows.length
        : 0;
    const reliability =
      bundleRows.length > 0
        ? bundleRows.reduce((sum, row) => sum + row.reliabilityRatio, 0) / bundleRows.length
        : 0;
    const stability =
      bundleRows.length > 0
        ? bundleRows.reduce((sum, row) => sum + row.stabilityRatio, 0) / bundleRows.length
        : 0;

    const blockedBundles = bundleRows
      .filter((row) => !row.ready)
      .map((row) => {
        const reasons: string[] = [];
        if (row.totalRequired === 0) {
          reasons.push("no_bundle_config");
        } else if (row.coverage < row.requiredCoverage) {
          reasons.push("coverage");
        }
        if (row.reliabilityRatio < 0.65) reasons.push("reliability");
        if (row.stabilityRatio < 0.5) reasons.push("stability");
        if (row.directEvidenceCovered < Math.min(row.totalRequired, MIN_DIRECT_BY_STAGE[stage])) reasons.push("direct_evidence");
        return {
          bundleKey: row.bundleKey,
          title: row.title,
          domain: row.domain,
          reason: reasons.length > 0 ? reasons.join(",") : "insufficient_signal",
          blockers: row.blockers,
        };
      });

    return {
      stage,
      ready: bundleRows.length > 0 && blockedBundles.length === 0,
      coverage: Number(clamp01(coverage).toFixed(4)),
      reliability: Number(clamp01(reliability).toFixed(4)),
      stability: Number(clamp01(stability).toFixed(4)),
      blockedBundles,
      bundleRows,
    };
  });

  return {
    rows,
    stageRows,
  };
}

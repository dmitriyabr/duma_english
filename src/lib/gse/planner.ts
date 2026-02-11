import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { CEFRStage } from "@/lib/curriculum";
import { getBundleNodeIdsForStage } from "./bundles";
import { computeDecayedMastery } from "./mastery";
import { mapStageToGseRange } from "./utils";

const STAGE_ORDER: CEFRStage[] = ["A0", "A1", "A2", "B1", "B2", "C1", "C2"];
function nextStage(stage: string): CEFRStage {
  const i = STAGE_ORDER.indexOf(stage as CEFRStage);
  if (i < 0 || i >= STAGE_ORDER.length - 1) return (stage as CEFRStage) || "A1";
  return STAGE_ORDER[i + 1];
}
function prevStage(stage: string): CEFRStage | null {
  const i = STAGE_ORDER.indexOf(stage as CEFRStage);
  if (i <= 0) return null;
  return STAGE_ORDER[i - 1];
}

type DomainKey = "vocab" | "grammar" | "lo";

function nodeDomain(nodeType: string) {
  if (nodeType === "GSE_VOCAB") return "vocab" as const;
  if (nodeType === "GSE_GRAMMAR") return "grammar" as const;
  return "lo" as const;
}

function taskDomainWeights(taskType: string): Record<DomainKey, number> {
  if (taskType === "target_vocab") return { vocab: 1, grammar: 0.45, lo: 0.4 };
  if (taskType === "read_aloud") return { vocab: 0.15, grammar: 0.35, lo: 1 };
  if (taskType === "qa_prompt") return { vocab: 0.5, grammar: 0.8, lo: 0.85 };
  if (taskType === "role_play") return { vocab: 0.5, grammar: 0.75, lo: 0.9 };
  if (taskType === "speech_builder") return { vocab: 0.5, grammar: 0.85, lo: 1 };
  if (taskType === "filler_control") return { vocab: 0.25, grammar: 0.5, lo: 0.8 };
  return { vocab: 0.45, grammar: 0.7, lo: 0.9 };
}

function stageDifficulty(stage: string) {
  if (stage === "A0") return 28;
  if (stage === "A1") return 40;
  if (stage === "A2") return 55;
  if (stage === "B1") return 67;
  if (stage === "B2") return 77;
  if (stage === "C1") return 85;
  return 90;
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function logistic(x: number) {
  return 1 / (1 + Math.exp(-x));
}

function round(value: number) {
  return Number(value.toFixed(2));
}

function dedupe<T>(items: T[]) {
  return Array.from(new Set(items));
}

/** Weighted random sample without replacement; weightFn must return > 0. */
function weightedSampleWithoutReplacement<T>(
  items: T[],
  k: number,
  weightFn: (item: T) => number
): T[] {
  if (items.length <= k) return [...items];
  const result: T[] = [];
  let remaining = items.map((item) => ({ item, weight: Math.max(1e-6, weightFn(item)) }));
  for (let s = 0; s < k && remaining.length > 0; s++) {
    const total = remaining.reduce((sum, x) => sum + x.weight, 0);
    let r = Math.random() * total;
    for (let i = 0; i < remaining.length; i++) {
      r -= remaining[i].weight;
      if (r <= 0) {
        result.push(remaining[i].item);
        remaining.splice(i, 1);
        break;
      }
    }
  }
  return result;
}

function buildPrimaryGoal(params: { overdueCount: number; weakCount: number; uncertainCount: number }) {
  if (params.overdueCount > 0) return "refresh_overdue_nodes";
  if (params.weakCount > 0) return "lift_weak_nodes";
  if (params.uncertainCount > 0) return "reduce_uncertainty";
  return "maintain_progress";
}

function nextDomainToProbe(recentTaskTypes: string[]) {
  const lastThree = recentTaskTypes.slice(0, 3);
  const counts: Record<DomainKey, number> = { vocab: 0, grammar: 0, lo: 0 };
  for (const taskType of lastThree) {
    const w = taskDomainWeights(taskType);
    (Object.keys(counts) as DomainKey[]).forEach((key) => {
      if (w[key] >= 0.75) counts[key] += 1;
    });
  }
  return (Object.entries(counts).sort((a, b) => a[1] - b[1])[0]?.[0] || "lo") as DomainKey;
}

function taskCluster(taskType: string) {
  if (taskType === "read_aloud") return "reading";
  if (taskType === "target_vocab") return "vocab";
  if (taskType === "filler_control") return "delivery";
  if (taskType === "qa_prompt" || taskType === "role_play") return "interaction";
  return "monologue";
}

function sameTypeStreak(recentTaskTypes: string[], taskType: string) {
  let streak = 0;
  for (const type of recentTaskTypes) {
    if (type !== taskType) break;
    streak += 1;
  }
  return streak;
}

function clusterCountInRecent(recentTaskTypes: string[], cluster: string, window = 5) {
  const recent = recentTaskTypes.slice(0, window);
  return recent.filter((type) => taskCluster(type) === cluster).length;
}

type NodeState = {
  nodeId: string;
  descriptor: string;
  skill: string | null;
  type: string;
  gseCenter: number | null;
  decayedMastery: number;
  masteryMean: number;
  masterySigma: number;
  reliability: "high" | "medium" | "low";
  daysSinceEvidence: number;
  halfLifeDays: number;
  domain: DomainKey;
  activationState: "observed" | "candidate_for_verification" | "verified";
  verificationDueAt: Date | null;
};

type CandidateScore = {
  taskType: string;
  targetNodeIds: string[];
  targetNodeDescriptors: string[];
  targetNodeTypes: string[];
  domainsTargeted: DomainKey[];
  expectedGain: number;
  successProbability: number;
  engagementRisk: number;
  tokenCost: number;
  latencyRisk: number;
  explorationBonus: number;
  verificationGain: number;
  utility: number;
  estimatedDifficulty: number;
  selectionReason: string;
  selectionReasonType: "weakness" | "overdue" | "uncertainty" | "verification";
};

export type PlannerDecision = {
  decisionId: string;
  chosenTaskType: string;
  targetNodeIds: string[];
  targetNodeDescriptors: string[];
  targetNodeTypes: string[];
  domainsTargeted: DomainKey[];
  diagnosticMode: boolean;
  rotationApplied: boolean;
  rotationReason: string | null;
  expectedGain: number;
  estimatedDifficulty: number;
  selectionReason: string;
  selectionReasonType: "weakness" | "overdue" | "uncertainty" | "verification";
  verificationTargetNodeIds: string[];
  primaryGoal: string;
  candidateScores: CandidateScore[];
};

export async function assignTaskTargetsFromCatalog(params: {
  taskId: string;
  stage: string;
  taskType: string;
  ageBand?: string | null;
  studentId?: string;
  preferredNodeIds?: string[];
  domainStages?: {
    vocab?: string;
    grammar?: string;
    communication?: string;
  };
}) {
  if (params.preferredNodeIds && params.preferredNodeIds.length > 0) {
    const selected = params.preferredNodeIds.slice(0, 3);
    await prisma.taskGseTarget.createMany({
      data: selected.map((nodeId, index) => ({
        taskId: params.taskId,
        nodeId,
        weight: index === 0 ? 1 : 0.7,
        required: index === 0,
      })),
      skipDuplicates: true,
    });
    return {
      targetNodeIds: selected,
      selectionReason: "Selected target nodes from planner decision.",
    };
  }

  const stageRange = mapStageToGseRange(params.stage || "A1");
  const ds = params.domainStages;
  const vocabRange = ds?.vocab ? mapStageToGseRange(ds.vocab) : stageRange;
  const grammarRange = ds?.grammar ? mapStageToGseRange(ds.grammar) : stageRange;
  const commRange = ds?.communication ? mapStageToGseRange(ds.communication) : stageRange;
  const audience = params.ageBand === "6-8" || params.ageBand === "9-11" || params.ageBand === "12-14" ? "YL" : "AL";
  const domainWeights = taskDomainWeights(params.taskType);
  const skills = [
    domainWeights.vocab >= 0.4 ? "vocabulary" : null,
    domainWeights.grammar >= 0.5 ? "grammar" : null,
    "speaking",
    "listening",
    "writing",
  ].filter((value): value is string => Boolean(value));

  let candidateNodes: Array<{
    nodeId: string;
    descriptor: string;
    gseCenter: number | null;
    skill: string | null;
  }> = [];
  if (params.studentId) {
    const audienceFilter = { in: [audience, "AL", "AE"] };
    const [vocabWeakest, grammarWeakest, loWeakest] = await Promise.all([
      domainWeights.vocab >= 0.4 ? prisma.studentGseMastery.findMany({
        where: {
          studentId: params.studentId,
          node: { audience: audienceFilter, type: "GSE_VOCAB", gseCenter: { gte: vocabRange.min - 3, lte: vocabRange.max + 3 } },
        },
        include: { node: { select: { nodeId: true, descriptor: true, gseCenter: true, skill: true } } },
        orderBy: [{ decayedMastery: "asc" }, { masteryScore: "asc" }],
        take: 4,
      }) : Promise.resolve([]),
      domainWeights.grammar >= 0.5 ? prisma.studentGseMastery.findMany({
        where: {
          studentId: params.studentId,
          node: { audience: audienceFilter, type: "GSE_GRAMMAR", gseCenter: { gte: grammarRange.min - 3, lte: grammarRange.max + 3 } },
        },
        include: { node: { select: { nodeId: true, descriptor: true, gseCenter: true, skill: true } } },
        orderBy: [{ decayedMastery: "asc" }, { masteryScore: "asc" }],
        take: 3,
      }) : Promise.resolve([]),
      prisma.studentGseMastery.findMany({
        where: {
          studentId: params.studentId,
          node: { audience: audienceFilter, type: "GSE_LO", skill: { in: ["speaking", "listening", "writing"] }, gseCenter: { gte: commRange.min - 3, lte: commRange.max + 3 } },
        },
        include: { node: { select: { nodeId: true, descriptor: true, gseCenter: true, skill: true } } },
        orderBy: [{ decayedMastery: "asc" }, { masteryScore: "asc" }],
        take: 3,
      }),
    ]);
    const merged = [...vocabWeakest, ...grammarWeakest, ...loWeakest];
    const seen = new Set<string>();
    candidateNodes = merged
      .map((row) => row.node)
      .filter((n) => { if (seen.has(n.nodeId)) return false; seen.add(n.nodeId); return true; });
  }

  if (candidateNodes.length === 0) {
    candidateNodes = await prisma.gseNode.findMany({
      where: {
        audience: { in: [audience, "AL", "AE"] },
        skill: { in: skills },
        gseCenter: {
          gte: stageRange.min - 3,
          lte: stageRange.max + 3,
        },
      },
      orderBy: [{ gseCenter: "asc" }, { updatedAt: "desc" }],
      take: 12,
      select: {
        nodeId: true,
        descriptor: true,
        gseCenter: true,
        skill: true,
      },
    });
  }

  const selected = candidateNodes.slice(0, 3);
  let targetNodeIds = selected.map((node) => node.nodeId);
  if (targetNodeIds.length === 0) {
    const hardFallback = await prisma.gseNode.findMany({
      where: {
        gseCenter: { gte: stageRange.min - 8, lte: stageRange.max + 8 },
      },
      orderBy: [{ gseCenter: "asc" }],
      select: { nodeId: true },
      take: 3,
    });
    targetNodeIds = hardFallback.map((row) => row.nodeId);
  }
  if (targetNodeIds.length === 0) {
    throw new Error("Planner could not resolve GSE targets for task assignment.");
  }
  await prisma.taskGseTarget.createMany({
    data: targetNodeIds.map((nodeId, index) => ({
      taskId: params.taskId,
      nodeId,
      weight: index === 0 ? 1 : 0.7,
      required: index === 0,
    })),
    skipDuplicates: true,
  });
  const selectionReason = `Selected ${targetNodeIds.length} GSE nodes for ${params.taskType} at ${params.stage}${params.studentId ? " using weakest-node targeting" : ""}.`;

  return { targetNodeIds, selectionReason };
}

export async function nextTargetNodesForStudent(studentId: string, limit = 3) {
  type Result = {
    nodeId: string;
    descriptor: string;
    skill: string | null;
    audience: string | null;
    gseCenter: number | null;
    masteryScore: number;
    reliability: "high" | "medium" | "low";
  };
  const toResult = (row: {
    nodeId: string;
    node: { descriptor: string; skill: string | null; audience: string | null; gseCenter: number | null };
    decayedMastery: number | null;
    masteryMean: number | null;
    masteryScore: number;
    reliability: string;
  }): Result => ({
    nodeId: row.nodeId,
    descriptor: row.node.descriptor,
    skill: row.node.skill,
    audience: row.node.audience,
    gseCenter: row.node.gseCenter,
    masteryScore: row.decayedMastery ?? row.masteryMean ?? row.masteryScore,
    reliability: row.reliability as "high" | "medium" | "low",
  });

  const nodeSelect = { nodeId: true, descriptor: true, gseCenter: true, skill: true, audience: true } as const;

  // Get student's target stage from LearnerProfile
  const profile = await prisma.learnerProfile.findUnique({ where: { studentId }, select: { stage: true } });
  const currentStage = (profile?.stage as CEFRStage) || "A1";
  const target = nextStage(currentStage);

  // Priority 1: Bundle nodes for target stage, weakest by decayedMastery, excluding verified+70
  const bundleNodeIds = await getBundleNodeIdsForStage(target);
  if (bundleNodeIds.length > 0) {
    const bundleRows = await prisma.studentGseMastery.findMany({
      where: {
        studentId,
        nodeId: { in: bundleNodeIds },
        NOT: { activationState: "verified", decayedMastery: { gte: 70 } },
      },
      orderBy: [{ decayedMastery: "asc" }, { masteryScore: "asc" }],
      take: limit,
      include: { node: { select: nodeSelect } },
    });
    if (bundleRows.length >= limit) return bundleRows.map(toResult);

    // Also include bundle nodes with no mastery row at all
    const seenIds = new Set(bundleRows.map((r) => r.nodeId));
    const missingBundleIds = bundleNodeIds.filter((id) => !seenIds.has(id));
    if (missingBundleIds.length > 0 && bundleRows.length < limit) {
      const missingNodes = await prisma.gseNode.findMany({
        where: { nodeId: { in: missingBundleIds.slice(0, limit - bundleRows.length) } },
        select: nodeSelect,
      });
      const results: Result[] = bundleRows.map(toResult);
      for (const n of missingNodes) {
        results.push({
          nodeId: n.nodeId,
          descriptor: n.descriptor,
          skill: n.skill,
          audience: n.audience,
          gseCenter: n.gseCenter,
          masteryScore: 0,
          reliability: "low",
        });
      }
      if (results.length > 0) return results.slice(0, limit);
    }

    if (bundleRows.length > 0) return bundleRows.map(toResult);
  }

  // Priority 2: Verification candidates (by verificationDueAt)
  const verificationRows = await prisma.studentGseMastery.findMany({
    where: { studentId, activationState: "candidate_for_verification" },
    orderBy: [{ verificationDueAt: "asc" }],
    take: limit,
    include: { node: { select: nodeSelect } },
  });
  if (verificationRows.length >= limit) return verificationRows.map(toResult);

  // Priority 3: Fallback — weakest by decayedMastery
  const fallbackRows = await prisma.studentGseMastery.findMany({
    where: { studentId },
    orderBy: [{ decayedMastery: "asc" }, { masteryScore: "asc" }, { updatedAt: "asc" }],
    take: limit,
    include: { node: { select: nodeSelect } },
  });

  // Merge: verification candidates first, then fallback (deduped)
  const seen = new Set<string>();
  const merged: Result[] = [];
  for (const row of [...verificationRows, ...fallbackRows]) {
    if (seen.has(row.nodeId)) continue;
    seen.add(row.nodeId);
    merged.push(toResult(row));
    if (merged.length >= limit) break;
  }
  return merged;
}

async function loadNodeState(params: {
  studentId: string;
  stage: string;
  ageBand?: string | null;
  taskTypes: string[];
  domainStages?: {
    vocab?: string;
    grammar?: string;
    communication?: string;
  };
}) {
  const stageRange = mapStageToGseRange(params.stage || "A1");
  // Expand GSE center range to cover all domain stages
  const ds = params.domainStages;
  const allRanges = [stageRange];
  if (ds?.vocab) allRanges.push(mapStageToGseRange(ds.vocab));
  if (ds?.grammar) allRanges.push(mapStageToGseRange(ds.grammar));
  if (ds?.communication) allRanges.push(mapStageToGseRange(ds.communication));
  const gseMin = Math.min(...allRanges.map(r => r.min));
  const gseMax = Math.max(...allRanges.map(r => r.max));
  const audience = params.ageBand === "6-8" || params.ageBand === "9-11" || params.ageBand === "12-14" ? "YL" : "AL";
  const now = new Date();

  const mastered = await prisma.studentGseMastery.findMany({
    where: {
      studentId: params.studentId,
      node: {
        audience: { in: [audience, "AL", "AE"] },
        gseCenter: { gte: gseMin - 5, lte: gseMax + 5 },
      },
    },
    include: {
      node: {
        select: {
          nodeId: true,
          descriptor: true,
          skill: true,
          type: true,
          gseCenter: true,
        },
      },
    },
    take: 60,
  });

  const states: NodeState[] = mastered.map((row) => {
    const reliability = (row.reliability as "high" | "medium" | "low") || "low";
    const masteryMean = row.masteryMean ?? row.masteryScore;
    const masterySigma = row.masterySigma ?? 24;
    const halfLifeDays = row.halfLifeDays ?? (row.node.type === "GSE_VOCAB" ? 14 : row.node.type === "GSE_GRAMMAR" ? 21 : 10);
    const descriptor = row.node.descriptor?.trim()
      ? row.node.descriptor
      : row.node.type === "GSE_GRAMMAR"
      ? "Grammar pattern"
      : "GSE item";
    const decayedMastery =
      row.decayedMastery ??
      computeDecayedMastery({
        masteryMean,
        lastEvidenceAt: row.lastEvidenceAt,
        now,
        halfLifeDays,
        evidenceCount: row.evidenceCount,
        reliability,
      });
    const daysSinceEvidence = row.lastEvidenceAt
      ? (now.getTime() - row.lastEvidenceAt.getTime()) / (1000 * 60 * 60 * 24)
      : 999;
    return {
      nodeId: row.nodeId,
      descriptor,
      skill: row.node.skill,
      type: row.node.type,
      domain: nodeDomain(row.node.type),
      gseCenter: row.node.gseCenter,
      decayedMastery: round(decayedMastery),
      masteryMean: round(masteryMean),
      masterySigma: round(masterySigma),
      reliability,
      daysSinceEvidence: round(daysSinceEvidence),
      halfLifeDays,
      activationState:
        row.activationState === "verified" || row.activationState === "candidate_for_verification"
          ? row.activationState
          : "observed",
      verificationDueAt: row.verificationDueAt ?? null,
    };
  });

  // Exclude fully mastered so they don't take pool slots; when they decay they re-enter (same row, lower decayedMastery)
  const statesFiltered = states.filter(
    (n) => !(n.activationState === "verified" && n.decayedMastery >= 70)
  );

  if (statesFiltered.length >= 8) return statesFiltered;

  const fallbackNodes = await prisma.gseNode.findMany({
    where: {
      audience: { in: [audience, "AL", "AE"] },
      gseCenter: { gte: stageRange.min - 2, lte: stageRange.max + 2 },
    },
    orderBy: [{ gseCenter: "asc" }],
    take: 20,
    select: {
      nodeId: true,
      descriptor: true,
      skill: true,
      type: true,
      gseCenter: true,
    },
  });

  for (const node of fallbackNodes) {
    if (statesFiltered.some((row) => row.nodeId === node.nodeId)) continue;
    const descriptor = node.descriptor?.trim()
      ? node.descriptor
      : node.type === "GSE_GRAMMAR"
      ? "Grammar pattern"
      : "GSE item";
    statesFiltered.push({
      nodeId: node.nodeId,
      descriptor,
      skill: node.skill,
      type: node.type,
      domain: nodeDomain(node.type),
      gseCenter: node.gseCenter,
      decayedMastery: 30,
      masteryMean: 30,
      masterySigma: 28,
      reliability: "low",
      daysSinceEvidence: 999,
      halfLifeDays: node.type === "GSE_VOCAB" ? 14 : node.type === "GSE_GRAMMAR" ? 21 : 10,
      activationState: "observed",
      verificationDueAt: null,
    });
    if (statesFiltered.length >= 20) break;
  }

  return statesFiltered;
}

/** Prev-stage not-fully-mastered nodes: bundle only, random sample, fewer than current pool. */
async function loadPrevStageNotMastered(params: {
  studentId: string;
  stage: string;
  ageBand?: string | null;
  currentPoolSize: number;
}): Promise<NodeState[]> {
  const prev = prevStage(params.stage);
  if (!prev) return [];
  const now = new Date();
  const maxAdd = Math.min(20, Math.max(0, params.currentPoolSize - 1));
  if (maxAdd <= 0) return [];

  const prevBundleIds = await getBundleNodeIdsForStage(prev);
  if (prevBundleIds.length === 0) return [];

  const [masteryForPrev, nodesForPrev] = await Promise.all([
    prisma.studentGseMastery.findMany({
      where: { studentId: params.studentId, nodeId: { in: prevBundleIds } },
      include: {
        node: { select: { nodeId: true, descriptor: true, skill: true, type: true, gseCenter: true } },
      },
    }),
    prisma.gseNode.findMany({
      where: { nodeId: { in: prevBundleIds } },
      select: { nodeId: true, descriptor: true, skill: true, type: true, gseCenter: true },
    }),
  ]);

  const masteryByNode = new Map(masteryForPrev.map((r) => [r.nodeId, r]));
  const nodeByNodeId = new Map(nodesForPrev.map((n) => [n.nodeId, n]));

  const candidates: NodeState[] = [];
  for (const nodeId of prevBundleIds) {
    const row = masteryByNode.get(nodeId);
    const node = nodeByNodeId.get(nodeId);
    if (!node) continue;
    const descriptor = node.descriptor?.trim()
      ? node.descriptor
      : node.type === "GSE_GRAMMAR"
      ? "Grammar pattern"
      : "GSE item";
    const halfLifeDays = node.type === "GSE_VOCAB" ? 14 : node.type === "GSE_GRAMMAR" ? 21 : 10;

    if (row) {
      const reliability = (row.reliability as "high" | "medium" | "low") || "low";
      const masteryMean = row.masteryMean ?? row.masteryScore;
      const decayedMastery =
        row.decayedMastery ??
        computeDecayedMastery({
          masteryMean,
          lastEvidenceAt: row.lastEvidenceAt,
          now,
          halfLifeDays,
          evidenceCount: row.evidenceCount,
          reliability,
        });
      const activationState =
        row.activationState === "verified" || row.activationState === "candidate_for_verification"
          ? row.activationState
          : "observed";
      if (activationState === "verified" && decayedMastery >= 70) continue;
      const daysSinceEvidence = row.lastEvidenceAt
        ? (now.getTime() - row.lastEvidenceAt.getTime()) / (1000 * 60 * 60 * 24)
        : 999;
      candidates.push({
        nodeId,
        descriptor,
        skill: node.skill,
        type: node.type,
        domain: nodeDomain(node.type),
        gseCenter: node.gseCenter,
        decayedMastery: round(decayedMastery),
        masteryMean: round(masteryMean),
        masterySigma: round(row.masterySigma ?? 24),
        reliability,
        daysSinceEvidence: round(daysSinceEvidence),
        halfLifeDays,
        activationState,
        verificationDueAt: row.verificationDueAt ?? null,
      });
    } else {
      candidates.push({
        nodeId,
        descriptor,
        skill: node.skill,
        type: node.type,
        domain: nodeDomain(node.type),
        gseCenter: node.gseCenter,
        decayedMastery: 30,
        masteryMean: 30,
        masterySigma: 28,
        reliability: "low",
        daysSinceEvidence: 999,
        halfLifeDays,
        activationState: "observed",
        verificationDueAt: null,
      });
    }
  }

  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  return candidates.slice(0, maxAdd);
}

function scoreCandidate(params: {
  taskType: string;
  nodes: NodeState[];
  stage: string;
  fatigueTypes: string[];
  recentTaskTypes: string[];
  diagnosticMode?: boolean;
  preferredNodeIds?: string[];
  qualityDomainFocus?: DomainKey | null;
  verificationNodeIds?: string[];
  recentlyTargetedNodeIds?: string[];
}) {
  const domainWeights = taskDomainWeights(params.taskType);
  const targetDomain = nextDomainToProbe(params.recentTaskTypes);
  const preferredSet = new Set(params.preferredNodeIds || []);
  const verificationSet = new Set(params.verificationNodeIds || []);
  const recentlyTargetedSet = new Set(params.recentlyTargetedNodeIds || []);
  const preferredNodes = params.nodes
    .filter((node) => preferredSet.has(node.nodeId))
    .sort((a, b) => a.decayedMastery - b.decayedMastery);
  const relevantNodes = params.nodes
    .map((node) => {
      const domainBoost = domainWeights[node.domain] || 0.3;
      const probeBonus = node.domain === targetDomain ? 10 : 0;
      const urgency = (100 - node.decayedMastery) * domainBoost + node.masterySigma * 0.9 + probeBonus;
      return { node, urgency };
    })
    .sort((a, b) => b.urgency - a.urgency)
    .map((row) => row.node)
    .sort((a, b) => a.decayedMastery - b.decayedMastery)
    .slice(0, 8);
  // Probabilistic: 2 from preferred by weight (weaker = more likely) so we don't always get the same two (e.g. kettle, formal)
  const fromPreferred = weightedSampleWithoutReplacement(
    preferredNodes,
    2,
    (node) => (100 - node.decayedMastery) + 1
  );
  const preferredIds = new Set(fromPreferred.map((n) => n.nodeId));
  const fromRelevant = relevantNodes.filter((n) => !preferredIds.has(n.nodeId));
  const mergedTargets = [...fromPreferred, ...fromRelevant].filter(
    (node, index, arr) => arr.findIndex((x) => x.nodeId === node.nodeId) === index
  );
  const targetNodes = (mergedTargets.length > 0 ? mergedTargets : params.nodes.slice(0, 3)).slice(0, 3);
  const estimatedDifficulty = stageDifficulty(params.stage);
  const perNode = targetNodes.map((node) => {
    const deficit = clamp(100 - node.decayedMastery);
    const successProbability = logistic((node.decayedMastery - estimatedDifficulty) / 12);
    const uncertaintyBoost = 1 + node.masterySigma / 75;
    const domainBoost = domainWeights[node.domain] || 0.35;
    const gain = deficit * 0.05 * successProbability * uncertaintyBoost * (0.6 + domainBoost);
    return {
      node,
      deficit,
      successProbability,
      gain,
    };
  });

  const expectedGain = perNode.reduce((sum, item) => sum + item.gain, 0);
  const successProbability =
    perNode.length > 0
      ? perNode.reduce((sum, item) => sum + item.successProbability, 0) / perNode.length
      : 0.4;
  const avgSigma =
    perNode.length > 0
      ? perNode.reduce((sum, item) => sum + item.node.masterySigma, 0) / perNode.length
      : 25;
  const engagementRisk = params.fatigueTypes.slice(0, 2).includes(params.taskType) ? 0.28 : 0.08;
  const typeStreak = sameTypeStreak(params.recentTaskTypes, params.taskType);
  const sameTypeCountInRecent = params.recentTaskTypes.filter((type) => type === params.taskType).length;
  const cluster = taskCluster(params.taskType);
  const sameClusterCount = clusterCountInRecent(params.recentTaskTypes, cluster, 5);
  const hardDiagnosticBlock = Boolean(params.diagnosticMode) && (typeStreak >= 2 || sameClusterCount >= 3);
  const repetitionPenalty =
    hardDiagnosticBlock
      ? 100
      : typeStreak >= 2
      ? 2.2
      : typeStreak === 1
      ? 0.9
      : sameTypeCountInRecent >= 3
      ? 0.8
      : sameClusterCount >= 3
      ? 1.1
      : 0;
  const tokenCost =
    params.taskType === "speech_builder" || params.taskType === "role_play" ? 1.3 : 0.9;
  const latencyRisk = params.taskType === "speech_builder" ? 0.22 : 0.1;
  const explorationBonus = clamp(avgSigma / 100, 0.05, 0.3);
  const preferredBoost = targetNodes.some((node) => preferredSet.has(node.nodeId)) ? 0.18 : 0;
  const domainRotationBonus = targetNodes.some((node) => node.domain === targetDomain) ? 0.35 : 0;
  const verificationHits = targetNodes.filter((node) => verificationSet.has(node.nodeId)).length;
  const verificationGain = verificationHits * 0.55;
  const recentlyTargetedOverlap = targetNodes.filter((node) => recentlyTargetedSet.has(node.nodeId)).length;
  const recentlyTargetedPenalty = recentlyTargetedOverlap * 0.28;
  const qualityDomainBoost = params.qualityDomainFocus
    ? targetNodes.some((node) => node.domain === params.qualityDomainFocus)
      ? 0.9
      : -0.55
    : 0;
  const utility =
    expectedGain -
    engagementRisk * 1.6 -
    repetitionPenalty -
    recentlyTargetedPenalty -
    tokenCost * 0.6 -
    latencyRisk * 0.8 +
    explorationBonus * 1.4 +
    preferredBoost +
    domainRotationBonus +
    qualityDomainBoost +
    verificationGain;
  const weakest = targetNodes[0];
  const rawDesc = weakest?.descriptor?.trim();
  const weakestLabel =
    !rawDesc || rawDesc === "No grammar descriptor available."
      ? (weakest?.domain === "grammar" ? "Grammar accuracy at this level" : "priority learning objective")
      : rawDesc;
  const domainLabel = weakest?.domain || targetDomain;
  const selectionReasonType: CandidateScore["selectionReasonType"] =
    verificationGain > 0
      ? "verification"
      : weakest && weakest.daysSinceEvidence > weakest.halfLifeDays
      ? "overdue"
      : weakest && weakest.masterySigma >= 22
      ? "uncertainty"
      : "weakness";
  const selectionReason = weakest
    ? verificationGain > 0
      ? `Verification priority: confirm node "${weakestLabel}" with expected gain ${round(expectedGain)}.`
      : `Targets ${domainLabel} node "${weakestLabel}" (${Math.round(weakest.decayedMastery)}) with expected gain ${round(expectedGain)}.`
    : `No node evidence yet; using stage ${params.stage} defaults.`;

  return {
    taskType: params.taskType,
    targetNodeIds: targetNodes.map((node) => node.nodeId),
    targetNodeDescriptors: targetNodes.map((node) => {
      const d = node.descriptor?.trim();
      if (!d || d === "No grammar descriptor available.") {
        return node.domain === "grammar" ? "Grammar accuracy at this level" : "Learning objective";
      }
      return d;
    }),
    targetNodeTypes: targetNodes.map((node) => node.type),
    domainsTargeted: Array.from(new Set(targetNodes.map((node) => node.domain))),
    expectedGain: round(expectedGain),
    successProbability: round(successProbability),
    engagementRisk: round(engagementRisk),
    tokenCost: round(tokenCost),
    latencyRisk: round(latencyRisk),
    explorationBonus: round(explorationBonus),
    verificationGain: round(verificationGain),
    utility: round(utility),
    estimatedDifficulty,
    selectionReason,
    selectionReasonType,
  };
}

export async function planNextTaskDecision(params: {
  studentId: string;
  stage: string;
  ageBand?: string | null;
  candidateTaskTypes: string[];
  requestedType?: string | null;
  diagnosticMode?: boolean;
  preferredNodeIds?: string[];
  qualityDomainFocus?: DomainKey | null;
  domainStages?: {
    vocab?: string;
    grammar?: string;
    communication?: string;
  };
}) : Promise<PlannerDecision> {
  const startedAt = Date.now();
  const candidateTaskTypes = dedupe(
    params.requestedType ? [params.requestedType, ...params.candidateTaskTypes] : params.candidateTaskTypes
  ).filter(Boolean);
  let taskTypes =
    candidateTaskTypes.length > 0
      ? candidateTaskTypes
      : ["read_aloud", "target_vocab", "qa_prompt", "role_play", "topic_talk", "filler_control", "speech_builder"];

  const targetStage = nextStage(params.stage);
  const [nodeStates, recentAttempts, recentInstances, targetStageBundleNodeIds] = await Promise.all([
    loadNodeState({
      studentId: params.studentId,
      stage: params.stage,
      ageBand: params.ageBand,
      taskTypes,
      domainStages: params.domainStages,
    }),
    prisma.attempt.findMany({
      where: { studentId: params.studentId, status: "completed" },
      include: { task: true },
      orderBy: { createdAt: "desc" },
      take: 3,
    }),
    prisma.taskInstance.findMany({
      where: { studentId: params.studentId },
      select: { taskType: true, targetNodeIds: true },
      orderBy: { createdAt: "desc" },
      take: 6,
    }),
    getBundleNodeIdsForStage(targetStage),
  ]);

  const inPool = new Set(nodeStates.map((n) => n.nodeId));
  const missingBundleIds = targetStageBundleNodeIds.filter((id) => !inPool.has(id));
  if (missingBundleIds.length > 0) {
    const maxAdd = 45;
    const bundleNodes = await prisma.gseNode.findMany({
      where: { nodeId: { in: missingBundleIds.slice(0, maxAdd) } },
      select: { nodeId: true, descriptor: true, skill: true, type: true, gseCenter: true },
    });
    for (const node of bundleNodes) {
      const descriptor = node.descriptor?.trim()
        ? node.descriptor
        : node.type === "GSE_GRAMMAR"
        ? "Grammar pattern"
        : "GSE item";
      nodeStates.push({
        nodeId: node.nodeId,
        descriptor,
        skill: node.skill,
        type: node.type,
        domain: nodeDomain(node.type),
        gseCenter: node.gseCenter,
        decayedMastery: 0,
        masteryMean: 0,
        masterySigma: 28,
        reliability: "low",
        daysSinceEvidence: 999,
        halfLifeDays: node.type === "GSE_VOCAB" ? 14 : node.type === "GSE_GRAMMAR" ? 21 : 10,
        activationState: "observed",
        verificationDueAt: null,
      });
      inPool.add(node.nodeId);
    }
  }

  // Lower-level refresh: any not-fully-mastered prev-stage bundle nodes; random sample; fewer than current pool
  const prevStageNodes = await loadPrevStageNotMastered({
    studentId: params.studentId,
    stage: params.stage,
    ageBand: params.ageBand,
    currentPoolSize: nodeStates.length,
  });
  for (const n of prevStageNodes) {
    if (!inPool.has(n.nodeId)) {
      nodeStates.push(n);
      inPool.add(n.nodeId);
    }
  }

  const verificationTargetNodeIds = nodeStates
    .filter((node) => node.activationState === "candidate_for_verification")
    .sort((a, b) => {
      const aDue = a.verificationDueAt ? a.verificationDueAt.getTime() : 0;
      const bDue = b.verificationDueAt ? b.verificationDueAt.getTime() : 0;
      return aDue - bDue;
    })
    .map((node) => node.nodeId)
    .slice(0, 4);

  const recoveryTriggered = recentAttempts.length >= 3 && recentAttempts.every((attempt) => {
    const scores = (attempt.scoresJson || {}) as { taskScore?: number };
    return typeof scores.taskScore === "number" && scores.taskScore < 55;
  });
  if (recoveryTriggered) {
    const recoveryTypes = ["read_aloud", "target_vocab", "qa_prompt", "filler_control"];
    const reduced = taskTypes.filter((type) => recoveryTypes.includes(type));
    taskTypes = reduced.length > 0 ? reduced : recoveryTypes;
  }

  const fatigueTypes = recentAttempts.map((attempt) => attempt.task.type);
  const recentTaskTypes = recentInstances.map((item) => item.taskType);
  const recentlyTargetedNodeIds = dedupe(
    recentInstances.slice(0, 3).flatMap((item) => item.targetNodeIds ?? [])
  );
  const recentVerificationHit = recentInstances
    .slice(0, 2)
    .some((item) => item.targetNodeIds.some((nodeId) => verificationTargetNodeIds.includes(nodeId)));
  // Verification first, then target-stage bundle nodes (so exercises align with progress), then other preferred
  const mergedPreferredNodeIds = dedupe([
    ...verificationTargetNodeIds,
    ...targetStageBundleNodeIds,
    ...(params.preferredNodeIds || []),
  ]);
  const scored = taskTypes.map((taskType) =>
    scoreCandidate({
      taskType,
      nodes: nodeStates,
      stage: params.stage,
      fatigueTypes,
      recentTaskTypes,
      diagnosticMode: params.diagnosticMode,
      preferredNodeIds: mergedPreferredNodeIds,
      qualityDomainFocus: params.qualityDomainFocus,
      verificationNodeIds: verificationTargetNodeIds,
      recentlyTargetedNodeIds,
    })
  );
  scored.sort((a, b) => b.utility - a.utility);
  const topCandidate = scored[0];
  let chosen = topCandidate;
  let rotationApplied = false;
  let rotationReason: string | null = null;
  if (topCandidate) {
    const topTypeStreak = sameTypeStreak(recentTaskTypes, topCandidate.taskType);
    const topCluster = taskCluster(topCandidate.taskType);
    const topClusterCount = clusterCountInRecent(recentTaskTypes, topCluster, 5);
    const violatesRotation = topTypeStreak >= 2 || topClusterCount >= 2;
    if (violatesRotation) {
      const alternative = scored.find((candidate) => {
        const typeStreak = sameTypeStreak(recentTaskTypes, candidate.taskType);
        const cluster = taskCluster(candidate.taskType);
        const clusterCount = clusterCountInRecent(recentTaskTypes, cluster, 5);
        return typeStreak < 2 && clusterCount < 2;
      });
      if (alternative) {
        chosen = alternative;
        rotationApplied = true;
        rotationReason =
          topTypeStreak >= 2
            ? `task_type_streak_${topTypeStreak}`
            : `thematic_cluster_streak_${topClusterCount}`;
      }
    }
  }
  if (!chosen || chosen.targetNodeIds.length === 0) {
    throw new Error("Planner decision failed: no GSE targets resolved.");
  }
  if (verificationTargetNodeIds.length > 0 && !recentVerificationHit && chosen.verificationGain <= 0) {
    const verificationCandidate = scored.find((row) => row.verificationGain > 0);
    if (verificationCandidate) {
      chosen = verificationCandidate;
    }
  }
  if (rotationApplied) {
    console.log(
      JSON.stringify({
        event: "planner_rotation_applied",
        studentId: params.studentId,
        blockedTaskType: topCandidate?.taskType || null,
        chosenTaskType: chosen.taskType,
        reason: rotationReason,
      })
    );
  }

  const overdueCount = nodeStates.filter((node) => node.daysSinceEvidence > node.halfLifeDays).length;
  const weakCount = nodeStates.filter((node) => node.decayedMastery < 55).length;
  const uncertainCount = nodeStates.filter((node) => node.masterySigma >= 22).length;
  const primaryGoal = recoveryTriggered
    ? "auto_recovery_path"
    : verificationTargetNodeIds.length > 0 && !recentVerificationHit
    ? "verify_candidate_nodes"
    : buildPrimaryGoal({ overdueCount, weakCount, uncertainCount });

  const decision = await prisma.plannerDecisionLog.create({
    data: {
      studentId: params.studentId,
      candidateSetJson: scored as unknown as Prisma.InputJsonValue,
      chosenTaskType: chosen.taskType,
      utilityJson: {
        expectedGain: chosen.expectedGain,
        successProbability: chosen.successProbability,
        engagementRisk: chosen.engagementRisk,
        tokenCost: chosen.tokenCost,
        latencyRisk: chosen.latencyRisk,
        explorationBonus: chosen.explorationBonus,
        verificationGain: chosen.verificationGain,
        utility: chosen.utility,
        rotationApplied,
        rotationReason,
        qualityDomainFocus: params.qualityDomainFocus || null,
      } as Prisma.InputJsonValue,
      fallbackUsed: false,
      latencyMs: Date.now() - startedAt,
      expectedGain: chosen.expectedGain,
      targetNodeIds: chosen.targetNodeIds,
      domainsTargeted: chosen.domainsTargeted,
      diagnosticMode: Boolean(params.diagnosticMode),
      selectionReason: chosen.selectionReason,
      primaryGoal,
      estimatedDifficulty: chosen.estimatedDifficulty,
    },
  });

  return {
    decisionId: decision.id,
    chosenTaskType: chosen.taskType,
    targetNodeIds: chosen.targetNodeIds,
    targetNodeDescriptors: chosen.targetNodeDescriptors,
    targetNodeTypes: chosen.targetNodeTypes,
    domainsTargeted: chosen.domainsTargeted,
    diagnosticMode: Boolean(params.diagnosticMode),
    rotationApplied,
    rotationReason,
    expectedGain: chosen.expectedGain,
    estimatedDifficulty: chosen.estimatedDifficulty,
    selectionReason: chosen.selectionReason,
    selectionReasonType: chosen.selectionReasonType,
    verificationTargetNodeIds,
    primaryGoal,
    candidateScores: scored,
  };
}

export async function finalizePlannerDecision(params: {
  decisionId: string;
  fallbackUsed: boolean;
  latencyMs?: number;
}) {
  await prisma.plannerDecisionLog.update({
    where: { id: params.decisionId },
    data: {
      fallbackUsed: params.fallbackUsed,
      latencyMs: params.latencyMs,
    },
  });
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export async function emitPlannerLatencySnapshot(params?: {
  sampleRate?: number;
  windowSize?: number;
}) {
  const sampleRate = typeof params?.sampleRate === "number" ? params.sampleRate : 0.15;
  const windowSize = typeof params?.windowSize === "number" ? params.windowSize : 200;
  if (Math.random() > sampleRate) return;

  const rows = await prisma.plannerDecisionLog.findMany({
    where: { latencyMs: { not: null } },
    orderBy: { decisionTs: "desc" },
    take: windowSize,
    select: { latencyMs: true },
  });
  const latencies = rows
    .map((row) => row.latencyMs)
    .filter((value): value is number => typeof value === "number");
  if (latencies.length === 0) return;
  const p95 = percentile(latencies, 95);
  if (typeof p95 !== "number") return;
  console.log(
    JSON.stringify({
      event: "planner_latency_snapshot",
      windowSize: latencies.length,
      p95Ms: p95,
      p50Ms: percentile(latencies, 50),
      p99Ms: percentile(latencies, 99),
    })
  );
}

export async function createTaskInstance(params: {
  studentId: string;
  taskId: string;
  decisionId?: string | null;
  taskType: string;
  targetNodeIds: string[];
  specJson: Prisma.InputJsonValue;
  fallbackUsed: boolean;
  estimatedDifficulty?: number | null;
}) {
  if (!params.targetNodeIds || params.targetNodeIds.length === 0) {
    throw new Error("Planner sanity check failed: targetNodeIds is empty.");
  }
  return prisma.taskInstance.create({
    data: {
      studentId: params.studentId,
      taskId: params.taskId,
      decisionLogId: params.decisionId || null,
      taskType: params.taskType,
      targetNodeIds: params.targetNodeIds,
      specJson: params.specJson,
      fallbackUsed: params.fallbackUsed,
      estimatedDifficulty: params.estimatedDifficulty ?? null,
    },
  });
}

export async function getPlannerDecisionById(decisionId: string, studentId: string) {
  return prisma.plannerDecisionLog.findFirst({
    where: { id: decisionId, studentId },
    include: {
      taskInstance: {
        select: {
          id: true,
          taskId: true,
          taskType: true,
          targetNodeIds: true,
          fallbackUsed: true,
          estimatedDifficulty: true,
          createdAt: true,
        },
      },
    },
  });
}

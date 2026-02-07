import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { computeDecayedMastery } from "./mastery";
import { mapStageToGseRange } from "./utils";

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
    const weakest = await prisma.studentGseMastery.findMany({
      where: {
        studentId: params.studentId,
        node: {
          audience: { in: [audience, "AL", "AE"] },
          skill: { in: skills },
          gseCenter: { gte: stageRange.min - 3, lte: stageRange.max + 3 },
        },
      },
      include: {
        node: {
          select: {
            nodeId: true,
            descriptor: true,
            gseCenter: true,
            skill: true,
          },
        },
      },
      orderBy: [{ decayedMastery: "asc" }, { masteryScore: "asc" }],
      take: 8,
    });
    candidateNodes = weakest.map((row) => row.node);
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
  const rows = await prisma.studentGseMastery.findMany({
    where: { studentId },
    orderBy: [{ decayedMastery: "asc" }, { masteryScore: "asc" }, { updatedAt: "asc" }],
    take: limit,
    include: {
      node: {
        select: { nodeId: true, descriptor: true, gseCenter: true, skill: true, audience: true },
      },
    },
  });
  return rows.map((row) => ({
    nodeId: row.nodeId,
    descriptor: row.node.descriptor,
    skill: row.node.skill,
    audience: row.node.audience,
    gseCenter: row.node.gseCenter,
    masteryScore: row.decayedMastery ?? row.masteryMean ?? row.masteryScore,
    reliability: row.reliability as "high" | "medium" | "low",
  }));
}

async function loadNodeState(params: {
  studentId: string;
  stage: string;
  ageBand?: string | null;
  taskTypes: string[];
}) {
  const stageRange = mapStageToGseRange(params.stage || "A1");
  const audience = params.ageBand === "6-8" || params.ageBand === "9-11" || params.ageBand === "12-14" ? "YL" : "AL";
  const now = new Date();

  const mastered = await prisma.studentGseMastery.findMany({
    where: {
      studentId: params.studentId,
      node: {
        audience: { in: [audience, "AL", "AE"] },
        gseCenter: { gte: stageRange.min - 5, lte: stageRange.max + 5 },
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
      descriptor: row.node.descriptor,
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

  if (states.length >= 8) return states;

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
    if (states.some((row) => row.nodeId === node.nodeId)) continue;
    states.push({
      nodeId: node.nodeId,
      descriptor: node.descriptor,
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
    if (states.length >= 20) break;
  }

  return states;
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
}) {
  const domainWeights = taskDomainWeights(params.taskType);
  const targetDomain = nextDomainToProbe(params.recentTaskTypes);
  const preferredSet = new Set(params.preferredNodeIds || []);
  const verificationSet = new Set(params.verificationNodeIds || []);
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
    .slice(0, 3);
  const mergedTargets = [...preferredNodes, ...relevantNodes].filter(
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
  const preferredBoost = targetNodes.some((node) => preferredSet.has(node.nodeId)) ? 0.4 : 0;
  const domainRotationBonus = targetNodes.some((node) => node.domain === targetDomain) ? 0.35 : 0;
  const verificationHits = targetNodes.filter((node) => verificationSet.has(node.nodeId)).length;
  const verificationGain = verificationHits * 1.15;
  const qualityDomainBoost = params.qualityDomainFocus
    ? targetNodes.some((node) => node.domain === params.qualityDomainFocus)
      ? 0.9
      : -0.55
    : 0;
  const utility =
    expectedGain -
    engagementRisk * 1.6 -
    repetitionPenalty -
    tokenCost * 0.6 -
    latencyRisk * 0.8 +
    explorationBonus * 1.4 +
    preferredBoost +
    domainRotationBonus +
    qualityDomainBoost +
    verificationGain;
  const weakest = targetNodes[0];
  const weakestLabel = weakest?.descriptor?.trim() || "priority learning objective";
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
}) : Promise<PlannerDecision> {
  const startedAt = Date.now();
  const candidateTaskTypes = dedupe(
    params.requestedType ? [params.requestedType, ...params.candidateTaskTypes] : params.candidateTaskTypes
  ).filter(Boolean);
  let taskTypes =
    candidateTaskTypes.length > 0
      ? candidateTaskTypes
      : ["read_aloud", "target_vocab", "qa_prompt", "role_play", "topic_talk", "filler_control", "speech_builder"];

  const [nodeStates, recentAttempts, recentInstances] = await Promise.all([
    loadNodeState({
      studentId: params.studentId,
      stage: params.stage,
      ageBand: params.ageBand,
      taskTypes,
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
  ]);
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
  const recentVerificationHit = recentInstances
    .slice(0, 2)
    .some((item) => item.targetNodeIds.some((nodeId) => verificationTargetNodeIds.includes(nodeId)));
  const mergedPreferredNodeIds = dedupe([
    ...(params.preferredNodeIds || []),
    ...verificationTargetNodeIds,
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

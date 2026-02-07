import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { computeDecayedMastery } from "./mastery";
import { mapStageToGseRange } from "./utils";

function skillHintsForTaskType(taskType: string) {
  if (taskType === "read_aloud") return ["speaking", "grammar"];
  if (taskType === "target_vocab") return ["vocabulary", "speaking"];
  if (taskType === "filler_control") return ["speaking"];
  if (taskType === "qa_prompt") return ["speaking", "writing"];
  if (taskType === "role_play") return ["speaking", "listening"];
  if (taskType === "speech_builder") return ["speaking"];
  return ["speaking", "vocabulary"];
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
};

type CandidateScore = {
  taskType: string;
  targetNodeIds: string[];
  expectedGain: number;
  successProbability: number;
  engagementRisk: number;
  tokenCost: number;
  latencyRisk: number;
  explorationBonus: number;
  utility: number;
  estimatedDifficulty: number;
  selectionReason: string;
};

export type PlannerDecision = {
  decisionId: string;
  chosenTaskType: string;
  targetNodeIds: string[];
  expectedGain: number;
  estimatedDifficulty: number;
  selectionReason: string;
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
  const skills = skillHintsForTaskType(params.taskType);

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
  if (selected.length > 0) {
    await prisma.taskGseTarget.createMany({
      data: selected.map((node, index) => ({
        taskId: params.taskId,
        nodeId: node.nodeId,
        weight: index === 0 ? 1 : 0.7,
        required: index === 0,
      })),
      skipDuplicates: true,
    });
  }

  const targetNodeIds = selected.map((node) => node.nodeId);
  const selectionReason =
    targetNodeIds.length > 0
      ? `Selected ${targetNodeIds.length} GSE nodes for ${params.taskType} at ${params.stage}${params.studentId ? " using weakest-node targeting" : ""}.`
      : "No matching GSE nodes found for current stage; fallback to skill planner.";

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
  const skills = dedupe(params.taskTypes.flatMap((taskType) => skillHintsForTaskType(taskType)));
  const now = new Date();

  const mastered = await prisma.studentGseMastery.findMany({
    where: {
      studentId: params.studentId,
      node: {
        audience: { in: [audience, "AL", "AE"] },
        skill: { in: skills },
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
      gseCenter: row.node.gseCenter,
      decayedMastery: round(decayedMastery),
      masteryMean: round(masteryMean),
      masterySigma: round(masterySigma),
      reliability,
      daysSinceEvidence: round(daysSinceEvidence),
      halfLifeDays,
    };
  });

  if (states.length >= 8) return states;

  const fallbackNodes = await prisma.gseNode.findMany({
    where: {
      audience: { in: [audience, "AL", "AE"] },
      skill: { in: skills },
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
      gseCenter: node.gseCenter,
      decayedMastery: 30,
      masteryMean: 30,
      masterySigma: 28,
      reliability: "low",
      daysSinceEvidence: 999,
      halfLifeDays: node.type === "GSE_VOCAB" ? 14 : node.type === "GSE_GRAMMAR" ? 21 : 10,
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
  preferredNodeIds?: string[];
}) {
  const relevantSkills = skillHintsForTaskType(params.taskType);
  const preferredSet = new Set(params.preferredNodeIds || []);
  const preferredNodes = params.nodes
    .filter((node) => preferredSet.has(node.nodeId))
    .sort((a, b) => a.decayedMastery - b.decayedMastery);
  const relevantNodes = params.nodes
    .filter((node) => !node.skill || relevantSkills.includes(node.skill))
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
    const uncertaintyBoost = 1 + node.masterySigma / 80;
    const gain = deficit * 0.06 * successProbability * uncertaintyBoost;
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
  const tokenCost =
    params.taskType === "speech_builder" || params.taskType === "role_play" ? 1.3 : 0.9;
  const latencyRisk = params.taskType === "speech_builder" ? 0.22 : 0.1;
  const explorationBonus = clamp(avgSigma / 100, 0.05, 0.3);
  const preferredBoost = targetNodes.some((node) => preferredSet.has(node.nodeId)) ? 0.4 : 0;
  const utility =
    expectedGain -
    engagementRisk * 1.6 -
    tokenCost * 0.6 -
    latencyRisk * 0.8 +
    explorationBonus * 1.4 +
    preferredBoost;
  const weakest = targetNodes[0];
  const selectionReason = weakest
    ? `Targets weak node ${weakest.nodeId} (${Math.round(weakest.decayedMastery)}) with expected gain ${round(expectedGain)}.`
    : `No node evidence yet; using stage ${params.stage} defaults.`;

  return {
    taskType: params.taskType,
    targetNodeIds: targetNodes.map((node) => node.nodeId),
    expectedGain: round(expectedGain),
    successProbability: round(successProbability),
    engagementRisk: round(engagementRisk),
    tokenCost: round(tokenCost),
    latencyRisk: round(latencyRisk),
    explorationBonus: round(explorationBonus),
    utility: round(utility),
    estimatedDifficulty,
    selectionReason,
  };
}

export async function planNextTaskDecision(params: {
  studentId: string;
  stage: string;
  ageBand?: string | null;
  candidateTaskTypes: string[];
  requestedType?: string | null;
  preferredNodeIds?: string[];
}) : Promise<PlannerDecision> {
  const startedAt = Date.now();
  const candidateTaskTypes = dedupe(
    params.requestedType ? [params.requestedType, ...params.candidateTaskTypes] : params.candidateTaskTypes
  ).filter(Boolean);
  let taskTypes = candidateTaskTypes.length > 0 ? candidateTaskTypes : ["topic_talk"];

  const [nodeStates, recentAttempts] = await Promise.all([
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
  ]);

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
  const scored = taskTypes.map((taskType) =>
    scoreCandidate({
      taskType,
      nodes: nodeStates,
      stage: params.stage,
      fatigueTypes,
      preferredNodeIds: params.preferredNodeIds,
    })
  );
  scored.sort((a, b) => b.utility - a.utility);
  const chosen = scored[0];

  const overdueCount = nodeStates.filter((node) => node.daysSinceEvidence > node.halfLifeDays).length;
  const weakCount = nodeStates.filter((node) => node.decayedMastery < 55).length;
  const uncertainCount = nodeStates.filter((node) => node.masterySigma >= 22).length;
  const primaryGoal = recoveryTriggered
    ? "auto_recovery_path"
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
        utility: chosen.utility,
      } as Prisma.InputJsonValue,
      fallbackUsed: false,
      latencyMs: Date.now() - startedAt,
      expectedGain: chosen.expectedGain,
      targetNodeIds: chosen.targetNodeIds,
      selectionReason: chosen.selectionReason,
      primaryGoal,
      estimatedDifficulty: chosen.estimatedDifficulty,
    },
  });

  return {
    decisionId: decision.id,
    chosenTaskType: chosen.taskType,
    targetNodeIds: chosen.targetNodeIds,
    expectedGain: chosen.expectedGain,
    estimatedDifficulty: chosen.estimatedDifficulty,
    selectionReason: chosen.selectionReason,
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

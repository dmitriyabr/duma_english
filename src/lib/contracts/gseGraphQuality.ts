export const GSE_GRAPH_EDGE_TYPES = [
  "prerequisite",
  "co_requisite",
  "supports",
  "transfer",
  "confusable",
] as const;

export type GseGraphEdgeType = (typeof GSE_GRAPH_EDGE_TYPES)[number];

const EDGE_TYPE_SET = new Set<string>(GSE_GRAPH_EDGE_TYPES);

export type GseGraphNodeSnapshot = {
  nodeId: string;
  descriptor?: string | null;
  critical: boolean;
};

export type GseGraphEdgeSnapshot = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  edgeType: string;
  metadataJson?: Record<string, unknown> | null;
};

export type GseGraphDriftSample = {
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  edgeType: string;
  eligibleLearners: number;
  successfulLearners: number;
  successRate: number | null;
};

type GseGraphDriftRule = {
  enabled: boolean;
  minEligibleLearners: number;
  minSuccessRate: number;
};

export const GSE_GRAPH_DRIFT_RULES: Record<GseGraphEdgeType, GseGraphDriftRule> = {
  prerequisite: {
    enabled: true,
    minEligibleLearners: 12,
    minSuccessRate: 0.45,
  },
  co_requisite: {
    enabled: true,
    minEligibleLearners: 12,
    minSuccessRate: 0.4,
  },
  supports: {
    enabled: true,
    minEligibleLearners: 12,
    minSuccessRate: 0.35,
  },
  transfer: {
    enabled: true,
    minEligibleLearners: 12,
    minSuccessRate: 0.35,
  },
  confusable: {
    enabled: false,
    minEligibleLearners: 0,
    minSuccessRate: 0,
  },
};

export type GseGraphQualityInput = {
  version: string;
  nodes: GseGraphNodeSnapshot[];
  edges: GseGraphEdgeSnapshot[];
  driftSamples?: GseGraphDriftSample[];
};

type DriftByTypeRow = {
  evaluated: number;
  flagged: number;
};

type IssueEdgeRow = {
  edgeId: string;
  edgeType: string;
  fromNodeId: string;
  toNodeId: string;
};

type OrphanNodeRow = {
  nodeId: string;
  descriptor: string | null;
};

type DriftFlaggedRow = {
  edgeId: string;
  edgeType: string;
  fromNodeId: string;
  toNodeId: string;
  eligibleLearners: number;
  successfulLearners: number;
  successRate: number;
  minSuccessRate: number;
  driftDelta: number;
};

type DriftRiskRow = {
  edgeId: string;
  edgeType: string;
  fromNodeId: string;
  toNodeId: string;
  eligibleLearners: number;
  successRate: number;
  minSuccessRate: number;
  driftDelta: number;
};

type EdgeDriftReport = {
  thresholds: Record<GseGraphEdgeType, GseGraphDriftRule>;
  evaluatedCount: number;
  insufficientSupportCount: number;
  flaggedCount: number;
  byType: Record<GseGraphEdgeType, DriftByTypeRow>;
  flagged: DriftFlaggedRow[];
  topRisk: DriftRiskRow[];
};

function round(value: number, fractionDigits = 4) {
  return Number(value.toFixed(fractionDigits));
}

function normalizeCycle(cycle: string[]) {
  if (cycle.length <= 2) return cycle.join("->");
  const open = cycle.slice(0, -1);
  let bestIndex = 0;
  for (let index = 1; index < open.length; index += 1) {
    if (open[index] < open[bestIndex]) {
      bestIndex = index;
    }
  }
  const rotated = [...open.slice(bestIndex), ...open.slice(0, bestIndex)];
  return [...rotated, rotated[0]].join("->");
}

function detectPrerequisiteCycles(nodeIds: string[], edges: GseGraphEdgeSnapshot[]) {
  const adjacency = new Map<string, string[]>();
  for (const nodeId of nodeIds) {
    adjacency.set(nodeId, []);
  }
  for (const edge of edges) {
    if (edge.edgeType !== "prerequisite") continue;
    if (edge.fromNodeId === edge.toNodeId) continue;
    if (!adjacency.has(edge.fromNodeId) || !adjacency.has(edge.toNodeId)) continue;
    adjacency.get(edge.fromNodeId)!.push(edge.toNodeId);
  }

  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const stackIndex = new Map<string, number>();
  const cycles: string[][] = [];
  const seenCycles = new Set<string>();

  const visit = (nodeId: string) => {
    state.set(nodeId, 1);
    stackIndex.set(nodeId, stack.length);
    stack.push(nodeId);

    for (const next of adjacency.get(nodeId) || []) {
      const nextState = state.get(next) ?? 0;
      if (nextState === 0) {
        visit(next);
        continue;
      }
      if (nextState !== 1) continue;
      const begin = stackIndex.get(next);
      if (typeof begin !== "number") continue;
      const cycle = [...stack.slice(begin), next];
      const key = normalizeCycle(cycle);
      if (seenCycles.has(key)) continue;
      seenCycles.add(key);
      cycles.push(cycle);
    }

    stack.pop();
    stackIndex.delete(nodeId);
    state.set(nodeId, 2);
  };

  for (const nodeId of nodeIds) {
    if ((state.get(nodeId) ?? 0) === 0) {
      visit(nodeId);
    }
  }

  return cycles;
}

export function buildEdgeDriftReport(samples: GseGraphDriftSample[]): EdgeDriftReport {
  const byType: Record<GseGraphEdgeType, DriftByTypeRow> = {
    prerequisite: { evaluated: 0, flagged: 0 },
    co_requisite: { evaluated: 0, flagged: 0 },
    supports: { evaluated: 0, flagged: 0 },
    transfer: { evaluated: 0, flagged: 0 },
    confusable: { evaluated: 0, flagged: 0 },
  };

  const flagged: DriftFlaggedRow[] = [];
  const topRisk: DriftRiskRow[] = [];

  let evaluatedCount = 0;
  let insufficientSupportCount = 0;

  for (const sample of samples) {
    if (!EDGE_TYPE_SET.has(sample.edgeType)) continue;
    const edgeType = sample.edgeType as GseGraphEdgeType;
    const rule = GSE_GRAPH_DRIFT_RULES[edgeType];
    if (!rule.enabled) continue;
    if (sample.successRate === null) continue;

    if (sample.eligibleLearners < rule.minEligibleLearners) {
      insufficientSupportCount += 1;
      continue;
    }

    evaluatedCount += 1;
    byType[edgeType].evaluated += 1;

    const successRate = round(sample.successRate);
    const driftDelta = round(successRate - rule.minSuccessRate);
    topRisk.push({
      edgeId: sample.edgeId,
      edgeType,
      fromNodeId: sample.fromNodeId,
      toNodeId: sample.toNodeId,
      eligibleLearners: sample.eligibleLearners,
      successRate,
      minSuccessRate: rule.minSuccessRate,
      driftDelta,
    });

    if (successRate >= rule.minSuccessRate) continue;
    byType[edgeType].flagged += 1;
    flagged.push({
      edgeId: sample.edgeId,
      edgeType,
      fromNodeId: sample.fromNodeId,
      toNodeId: sample.toNodeId,
      eligibleLearners: sample.eligibleLearners,
      successfulLearners: sample.successfulLearners,
      successRate,
      minSuccessRate: rule.minSuccessRate,
      driftDelta,
    });
  }

  topRisk.sort((left, right) => left.driftDelta - right.driftDelta);

  return {
    thresholds: GSE_GRAPH_DRIFT_RULES,
    evaluatedCount,
    insufficientSupportCount,
    flaggedCount: flagged.length,
    byType,
    flagged: flagged.slice(0, 100),
    topRisk: topRisk.slice(0, 25),
  };
}

export function buildGseGraphQualityReport(input: GseGraphQualityInput) {
  const nodeById = new Map<string, GseGraphNodeSnapshot>();
  for (const node of input.nodes) {
    const current = nodeById.get(node.nodeId);
    if (!current) {
      nodeById.set(node.nodeId, node);
      continue;
    }
    nodeById.set(node.nodeId, {
      nodeId: node.nodeId,
      descriptor: node.descriptor ?? current.descriptor ?? null,
      critical: current.critical || node.critical,
    });
  }
  const allNodes = [...nodeById.values()];
  const criticalNodes = allNodes.filter((node) => node.critical);

  const invalidEdgeTypes: IssueEdgeRow[] = [];
  const danglingEdges: IssueEdgeRow[] = [];
  const selfLoopPrerequisites: IssueEdgeRow[] = [];
  const incidentByNode = new Map<string, number>();

  for (const edge of input.edges) {
    const base: IssueEdgeRow = {
      edgeId: edge.id,
      edgeType: edge.edgeType,
      fromNodeId: edge.fromNodeId,
      toNodeId: edge.toNodeId,
    };

    const validType = EDGE_TYPE_SET.has(edge.edgeType);
    if (!validType) {
      invalidEdgeTypes.push(base);
      continue;
    }

    const fromExists = nodeById.has(edge.fromNodeId);
    const toExists = nodeById.has(edge.toNodeId);
    if (!fromExists || !toExists) {
      danglingEdges.push(base);
      continue;
    }

    if (edge.edgeType === "prerequisite" && edge.fromNodeId === edge.toNodeId) {
      selfLoopPrerequisites.push(base);
      continue;
    }

    incidentByNode.set(edge.fromNodeId, (incidentByNode.get(edge.fromNodeId) || 0) + 1);
    incidentByNode.set(edge.toNodeId, (incidentByNode.get(edge.toNodeId) || 0) + 1);
  }

  const prerequisiteCycles = detectPrerequisiteCycles(
    allNodes.map((node) => node.nodeId),
    input.edges
  );

  const orphanCriticalNodes: OrphanNodeRow[] = [];
  for (const node of criticalNodes) {
    if ((incidentByNode.get(node.nodeId) || 0) > 0) continue;
    orphanCriticalNodes.push({
      nodeId: node.nodeId,
      descriptor: node.descriptor ?? null,
    });
  }

  const drift = buildEdgeDriftReport(input.driftSamples || []);

  const releaseBlocker =
    invalidEdgeTypes.length > 0 ||
    danglingEdges.length > 0 ||
    selfLoopPrerequisites.length > 0 ||
    prerequisiteCycles.length > 0 ||
    orphanCriticalNodes.length > 0;

  return {
    version: input.version,
    generatedAt: new Date().toISOString(),
    summary: {
      nodeCount: allNodes.length,
      criticalNodeCount: criticalNodes.length,
      edgeCount: input.edges.length,
      invalidEdgeTypeCount: invalidEdgeTypes.length,
      danglingEdgeCount: danglingEdges.length,
      selfLoopPrerequisiteCount: selfLoopPrerequisites.length,
      prerequisiteCycleCount: prerequisiteCycles.length,
      orphanCriticalCount: orphanCriticalNodes.length,
      driftEvaluatedEdgeCount: drift.evaluatedCount,
      driftFlaggedEdgeCount: drift.flaggedCount,
      releaseBlocker,
    },
    issues: {
      invalidEdgeTypes,
      danglingEdges,
      selfLoopPrerequisites,
      prerequisiteCycles: prerequisiteCycles.slice(0, 25),
      orphanCriticalNodes: orphanCriticalNodes.slice(0, 100),
    },
    drift,
  };
}

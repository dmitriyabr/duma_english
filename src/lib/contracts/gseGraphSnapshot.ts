import type { GseGraphDriftSample, GseGraphEdgeSnapshot, GseGraphNodeSnapshot } from "./gseGraphQuality";

export const GSE_GRAPH_SNAPSHOT_VERSION = "gse-graph-contract.v1.2026-02-17";

export const GSE_GRAPH_SNAPSHOT_NODES: GseGraphNodeSnapshot[] = [
  { nodeId: "bundle:A1:vocab", descriptor: "A1 Vocabulary Core", critical: true },
  { nodeId: "bundle:A2:vocab", descriptor: "A2 Vocabulary Core", critical: true },
  { nodeId: "bundle:B1:vocab", descriptor: "B1 Vocabulary Core", critical: true },
  { nodeId: "bundle:A1:grammar", descriptor: "A1 Grammar Core", critical: true },
  { nodeId: "bundle:A2:grammar", descriptor: "A2 Grammar Core", critical: true },
  { nodeId: "bundle:B1:grammar", descriptor: "B1 Grammar Core", critical: true },
  { nodeId: "bundle:A1:lo", descriptor: "A1 Can-Do Core", critical: true },
  { nodeId: "bundle:A2:lo", descriptor: "A2 Can-Do Core", critical: true },
  { nodeId: "bundle:B1:lo", descriptor: "B1 Can-Do Core", critical: true },
];

export const GSE_GRAPH_SNAPSHOT_EDGES: GseGraphEdgeSnapshot[] = [
  {
    id: "edge:vocab:A1:A2",
    edgeType: "prerequisite",
    fromNodeId: "bundle:A1:vocab",
    toNodeId: "bundle:A2:vocab",
  },
  {
    id: "edge:vocab:A2:B1",
    edgeType: "prerequisite",
    fromNodeId: "bundle:A2:vocab",
    toNodeId: "bundle:B1:vocab",
  },
  {
    id: "edge:grammar:A1:A2",
    edgeType: "prerequisite",
    fromNodeId: "bundle:A1:grammar",
    toNodeId: "bundle:A2:grammar",
  },
  {
    id: "edge:grammar:A2:B1",
    edgeType: "prerequisite",
    fromNodeId: "bundle:A2:grammar",
    toNodeId: "bundle:B1:grammar",
  },
  {
    id: "edge:lo:A1:A2",
    edgeType: "prerequisite",
    fromNodeId: "bundle:A1:lo",
    toNodeId: "bundle:A2:lo",
  },
  {
    id: "edge:lo:A2:B1",
    edgeType: "prerequisite",
    fromNodeId: "bundle:A2:lo",
    toNodeId: "bundle:B1:lo",
  },
  {
    id: "edge:grammar-to-lo:A2",
    edgeType: "supports",
    fromNodeId: "bundle:A2:grammar",
    toNodeId: "bundle:A2:lo",
  },
  {
    id: "edge:vocab-to-lo:B1",
    edgeType: "transfer",
    fromNodeId: "bundle:A2:vocab",
    toNodeId: "bundle:B1:lo",
  },
];

export const GSE_GRAPH_SNAPSHOT_DRIFT: GseGraphDriftSample[] = [
  {
    edgeId: "edge:vocab:A1:A2",
    edgeType: "prerequisite",
    fromNodeId: "bundle:A1:vocab",
    toNodeId: "bundle:A2:vocab",
    eligibleLearners: 32,
    successfulLearners: 24,
    successRate: 0.75,
  },
  {
    edgeId: "edge:vocab:A2:B1",
    edgeType: "prerequisite",
    fromNodeId: "bundle:A2:vocab",
    toNodeId: "bundle:B1:vocab",
    eligibleLearners: 28,
    successfulLearners: 17,
    successRate: 0.6071,
  },
  {
    edgeId: "edge:grammar:A1:A2",
    edgeType: "prerequisite",
    fromNodeId: "bundle:A1:grammar",
    toNodeId: "bundle:A2:grammar",
    eligibleLearners: 30,
    successfulLearners: 19,
    successRate: 0.6333,
  },
  {
    edgeId: "edge:grammar:A2:B1",
    edgeType: "prerequisite",
    fromNodeId: "bundle:A2:grammar",
    toNodeId: "bundle:B1:grammar",
    eligibleLearners: 26,
    successfulLearners: 14,
    successRate: 0.5385,
  },
  {
    edgeId: "edge:lo:A1:A2",
    edgeType: "prerequisite",
    fromNodeId: "bundle:A1:lo",
    toNodeId: "bundle:A2:lo",
    eligibleLearners: 31,
    successfulLearners: 20,
    successRate: 0.6452,
  },
  {
    edgeId: "edge:lo:A2:B1",
    edgeType: "prerequisite",
    fromNodeId: "bundle:A2:lo",
    toNodeId: "bundle:B1:lo",
    eligibleLearners: 24,
    successfulLearners: 13,
    successRate: 0.5417,
  },
  {
    edgeId: "edge:grammar-to-lo:A2",
    edgeType: "supports",
    fromNodeId: "bundle:A2:grammar",
    toNodeId: "bundle:A2:lo",
    eligibleLearners: 23,
    successfulLearners: 11,
    successRate: 0.4783,
  },
  {
    edgeId: "edge:vocab-to-lo:B1",
    edgeType: "transfer",
    fromNodeId: "bundle:A2:vocab",
    toNodeId: "bundle:B1:lo",
    eligibleLearners: 22,
    successfulLearners: 9,
    successRate: 0.4091,
  },
];

export const GSE_GRAPH_SNAPSHOT = {
  version: GSE_GRAPH_SNAPSHOT_VERSION,
  nodes: GSE_GRAPH_SNAPSHOT_NODES,
  edges: GSE_GRAPH_SNAPSHOT_EDGES,
  driftSamples: GSE_GRAPH_SNAPSHOT_DRIFT,
} as const;

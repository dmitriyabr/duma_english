import assert from "node:assert/strict";
import test from "node:test";
import { buildEdgeDriftReport, buildGseGraphQualityReport } from "./gseGraphQuality";
import { GSE_GRAPH_SNAPSHOT } from "./gseGraphSnapshot";

test("graph quality snapshot passes all release blockers", () => {
  const report = buildGseGraphQualityReport(GSE_GRAPH_SNAPSHOT);
  assert.equal(report.summary.releaseBlocker, false, JSON.stringify(report.issues, null, 2));
  assert.equal(report.summary.invalidEdgeTypeCount, 0);
  assert.equal(report.summary.prerequisiteCycleCount, 0);
  assert.equal(report.summary.orphanCriticalCount, 0);
});

test("graph quality validator flags invalid edge types and cycles", () => {
  const report = buildGseGraphQualityReport({
    version: "broken-graph.v1",
    nodes: [
      { nodeId: "n1", descriptor: "n1", critical: true },
      { nodeId: "n2", descriptor: "n2", critical: true },
    ],
    edges: [
      { id: "e1", fromNodeId: "n1", toNodeId: "n2", edgeType: "prerequisite" },
      { id: "e2", fromNodeId: "n2", toNodeId: "n1", edgeType: "prerequisite" },
      { id: "e3", fromNodeId: "n1", toNodeId: "n2", edgeType: "unknown_type" },
    ],
  });

  assert.equal(report.summary.releaseBlocker, true);
  assert.equal(report.summary.invalidEdgeTypeCount, 1);
  assert.ok(report.summary.prerequisiteCycleCount > 0);
});

test("graph quality validator flags orphan critical nodes", () => {
  const report = buildGseGraphQualityReport({
    version: "orphaned-graph.v1",
    nodes: [
      { nodeId: "n1", descriptor: "n1", critical: true },
      { nodeId: "n2", descriptor: "n2", critical: true },
      { nodeId: "n3", descriptor: "n3", critical: true },
    ],
    edges: [{ id: "e1", fromNodeId: "n1", toNodeId: "n2", edgeType: "prerequisite" }],
  });

  assert.equal(report.summary.releaseBlocker, true);
  assert.equal(report.summary.orphanCriticalCount, 1);
  assert.equal(report.issues.orphanCriticalNodes[0]?.nodeId, "n3");
});

test("edge drift report flags low-performing edges only with enough support", () => {
  const report = buildEdgeDriftReport([
    {
      edgeId: "e1",
      edgeType: "prerequisite",
      fromNodeId: "n1",
      toNodeId: "n2",
      eligibleLearners: 20,
      successfulLearners: 6,
      successRate: 0.3,
    },
    {
      edgeId: "e2",
      edgeType: "transfer",
      fromNodeId: "n2",
      toNodeId: "n3",
      eligibleLearners: 6,
      successfulLearners: 1,
      successRate: 0.1667,
    },
  ]);

  assert.equal(report.evaluatedCount, 1);
  assert.equal(report.insufficientSupportCount, 1);
  assert.equal(report.flaggedCount, 1);
  assert.equal(report.flagged[0]?.edgeId, "e1");
});

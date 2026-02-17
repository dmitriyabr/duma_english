import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { GSE_GRAPH_SNAPSHOT } from "../lib/contracts/gseGraphSnapshot";
import {
  buildGseGraphQualityReport,
  type GseGraphDriftSample,
  type GseGraphQualityInput,
} from "../lib/contracts/gseGraphQuality";

type CliOptions = {
  strict: boolean;
  source: "snapshot" | "db";
  outputPath: string | null;
};

type MasterySampleRow = {
  studentId: string;
  nodeId: string;
  masteryScore: number;
  masteryMean: number | null;
  decayedMastery: number | null;
  directEvidenceCount: number;
};

function parseStringFlag(args: string[], flag: string) {
  const index = args.findIndex((arg) => arg === flag);
  if (index < 0) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) return null;
  return value;
}

function parseOptions(args: string[]): CliOptions {
  return {
    strict: !args.includes("--no-strict"),
    source: args.includes("--db") ? "db" : "snapshot",
    outputPath: parseStringFlag(args, "--output"),
  };
}

function masteryValue(row: MasterySampleRow) {
  return row.decayedMastery ?? row.masteryMean ?? row.masteryScore;
}

function intersectionSize<T>(left: Set<T>, right: Set<T>) {
  if (left.size === 0 || right.size === 0) return 0;
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  let count = 0;
  for (const value of small) {
    if (large.has(value)) count += 1;
  }
  return count;
}

async function loadGraphInputFromDb(): Promise<{
  input: GseGraphQualityInput;
  disconnect: () => Promise<void>;
}> {
  const [{ prisma }, { ensureDefaultGseBundles }] = await Promise.all([import("../lib/db"), import("../lib/gse/bundles")]);

  await ensureDefaultGseBundles();

  const latestCatalogVersion = await prisma.gseCatalogVersion.findFirst({
    orderBy: { createdAt: "desc" },
    select: { version: true },
  });

  const [bundles, edges] = await Promise.all([
    prisma.gseBundle.findMany({
      where: { active: true },
      include: {
        nodes: {
          where: { required: true },
          include: { node: { select: { nodeId: true, descriptor: true } } },
        },
      },
    }),
    prisma.gseNodeEdge.findMany({
      select: {
        id: true,
        fromNodeId: true,
        toNodeId: true,
        edgeType: true,
        metadataJson: true,
      },
    }),
  ]);

  const criticalNodeDescriptors = new Map<string, string | null>();
  for (const bundle of bundles) {
    for (const nodeRow of bundle.nodes) {
      if (!criticalNodeDescriptors.has(nodeRow.nodeId)) {
        criticalNodeDescriptors.set(nodeRow.nodeId, nodeRow.node.descriptor ?? null);
      }
    }
  }

  const edgeNodeIds = new Set<string>();
  for (const edge of edges) {
    edgeNodeIds.add(edge.fromNodeId);
    edgeNodeIds.add(edge.toNodeId);
  }
  const uncachedNodeIds = [...edgeNodeIds].filter((nodeId) => !criticalNodeDescriptors.has(nodeId));
  const uncachedNodes =
    uncachedNodeIds.length > 0
      ? await prisma.gseNode.findMany({
          where: { nodeId: { in: uncachedNodeIds } },
          select: { nodeId: true, descriptor: true },
        })
      : [];

  const descriptorByNode = new Map(criticalNodeDescriptors);
  for (const node of uncachedNodes) {
    descriptorByNode.set(node.nodeId, node.descriptor ?? null);
  }

  const nodes = [...descriptorByNode.entries()].map(([nodeId, descriptor]) => ({
    nodeId,
    descriptor,
    critical: criticalNodeDescriptors.has(nodeId),
  }));

  const relevantNodeIds = [...edgeNodeIds];
  const masteryRows =
    relevantNodeIds.length > 0
      ? await prisma.studentGseMastery.findMany({
          where: { nodeId: { in: relevantNodeIds } },
          select: {
            studentId: true,
            nodeId: true,
            masteryScore: true,
            masteryMean: true,
            decayedMastery: true,
            directEvidenceCount: true,
          },
        })
      : [];

  const eligibleByNode = new Map<string, Set<string>>();
  const successByNode = new Map<string, Set<string>>();
  for (const row of masteryRows) {
    const value = masteryValue(row);
    if (value >= 60 && row.directEvidenceCount >= 2) {
      const set = eligibleByNode.get(row.nodeId) || new Set<string>();
      set.add(row.studentId);
      eligibleByNode.set(row.nodeId, set);
    }
    if (value >= 50) {
      const set = successByNode.get(row.nodeId) || new Set<string>();
      set.add(row.studentId);
      successByNode.set(row.nodeId, set);
    }
  }

  const driftSamples: GseGraphDriftSample[] = edges.map((edge) => {
    const eligible = eligibleByNode.get(edge.fromNodeId) || new Set<string>();
    const successful = successByNode.get(edge.toNodeId) || new Set<string>();
    const eligibleLearners = eligible.size;
    const successfulLearners = intersectionSize(eligible, successful);
    const successRate = eligibleLearners > 0 ? Number((successfulLearners / eligibleLearners).toFixed(4)) : null;
    return {
      edgeId: edge.id,
      edgeType: edge.edgeType,
      fromNodeId: edge.fromNodeId,
      toNodeId: edge.toNodeId,
      eligibleLearners,
      successfulLearners,
      successRate,
    };
  });

  return {
    input: {
      version: latestCatalogVersion?.version || "db-live",
      nodes,
      edges: edges.map((edge) => ({
        id: edge.id,
        fromNodeId: edge.fromNodeId,
        toNodeId: edge.toNodeId,
        edgeType: edge.edgeType,
        metadataJson:
          edge.metadataJson && typeof edge.metadataJson === "object"
            ? (edge.metadataJson as Record<string, unknown>)
            : null,
      })),
      driftSamples,
    },
    disconnect: async () => {
      await prisma.$disconnect();
    },
  };
}

async function maybeWriteOutput(path: string | null, report: unknown) {
  if (!path) return;
  const outputPath = resolve(process.cwd(), path);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const teardown: Array<() => Promise<void>> = [];

  try {
    let input: GseGraphQualityInput;
    if (options.source === "db") {
      const loaded = await loadGraphInputFromDb();
      input = loaded.input;
      teardown.push(loaded.disconnect);
    } else {
      input = GSE_GRAPH_SNAPSHOT;
    }

    const report = buildGseGraphQualityReport(input);
    await maybeWriteOutput(options.outputPath, report);
    console.log(JSON.stringify(report, null, 2));

    if (options.strict && report.summary.releaseBlocker) {
      console.error(
        `[graph-quality] release blocker: invalidEdgeTypes=${report.summary.invalidEdgeTypeCount}, danglingEdges=${report.summary.danglingEdgeCount}, prerequisiteCycles=${report.summary.prerequisiteCycleCount}, orphanCritical=${report.summary.orphanCriticalCount}`
      );
      process.exit(1);
    }
  } finally {
    for (const close of teardown) {
      await close();
    }
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[graph-quality] ${message}`);
  process.exit(1);
});

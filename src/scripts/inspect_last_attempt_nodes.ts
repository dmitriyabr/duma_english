/**
 * Inspect last attempt: node outcomes (decay impact), mastery for ALL nodes in the attempt, candidate readiness.
 * Run: npx tsx src/scripts/inspect_last_attempt_nodes.ts          — show all nodes from last attempt
 * Run: npx tsx src/scripts/inspect_last_attempt_nodes.ts feel    — filter to descriptors containing "feel"
 */
import "dotenv/config";
import { prisma } from "../lib/db";

function parseSpacingState(json: unknown): { types: string[]; confidences: number[] } {
  if (!json || typeof json !== "object") return { types: [], confidences: [] };
  const raw = json as Record<string, unknown>;
  const types = Array.isArray(raw.incidentalTaskTypes)
    ? raw.incidentalTaskTypes.map(String).filter(Boolean)
    : [];
  const confidences = Array.isArray(raw.incidentalConfidences)
    ? raw.incidentalConfidences.map((v) => (typeof v === "number" ? v : Number(v))).filter(Number.isFinite)
    : [];
  return { types, confidences };
}

function median(arr: number[]) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

async function main() {
  const filterWords = process.argv.slice(2).map((w) => w.toLowerCase());
  const attempt = await prisma.attempt.findFirst({
    where: { status: "completed" },
    orderBy: { completedAt: "desc" },
    include: { task: { select: { type: true, prompt: true } } },
  });
  if (!attempt) {
    console.log("No completed attempt found.");
    return;
  }

  const nodeOutcomes = (attempt.nodeOutcomesJson || []) as Array<{
    nodeId: string;
    previousMean: number;
    nextMean: number;
    previousDecayed: number;
    nextDecayed: number;
    deltaMastery: number;
    decayImpact: number;
    activationStateBefore?: string;
    activationStateAfter?: string;
    activationImpact?: string;
    evidenceCount: number;
  }>;

  console.log("=== Last attempt ===");
  console.log("Attempt id:", attempt.id);
  console.log("Task type:", attempt.task?.type);
  console.log("Completed:", attempt.completedAt?.toISOString());
  console.log("\n=== Node outcomes (from nodeOutcomesJson) ===");
  for (const o of nodeOutcomes) {
    console.log(
      `  ${o.nodeId}: deltaMastery=${o.deltaMastery?.toFixed(1) ?? "?"} decayImpact=${o.decayImpact?.toFixed(1) ?? "?"} (prevMean=${o.previousMean?.toFixed(1)} prevDecayed=${o.previousDecayed?.toFixed(1)} nextMean=${o.nextMean?.toFixed(1)} nextDecayed=${o.nextDecayed?.toFixed(1)}) state=${o.activationStateBefore}->${o.activationStateAfter} impact=${o.activationImpact ?? "none"}`
    );
  }

  const nodeIds = nodeOutcomes.map((o) => o.nodeId);
  if (nodeIds.length === 0) {
    console.log("No node outcomes.");
    return;
  }

  const masteryRows = await prisma.studentGseMastery.findMany({
    where: { studentId: attempt.studentId, nodeId: { in: nodeIds } },
    include: { node: { select: { descriptor: true, type: true } } },
  });

  const byDescriptor = new Map<string, typeof masteryRows[0]>();
  for (const m of masteryRows) byDescriptor.set(m.node.descriptor ?? m.nodeId, m);

  console.log("\n=== Mastery for ALL nodes in this attempt (spacing state + candidate check) ===");
  for (const m of masteryRows) {
    const desc = (m.node.descriptor ?? m.nodeId).toLowerCase();
    const matchFilter = filterWords.length === 0 || filterWords.some((w) => desc.includes(w));
    if (!matchFilter && filterWords.length > 0) continue;

    const spacing = parseSpacingState(m.spacingStateJson);
    const med = median(spacing.confidences);
    const candidateReady =
      spacing.confidences.length >= 3 && spacing.types.length >= 2 && med >= 0.7;

    console.log(`  [${m.node.descriptor ?? m.nodeId}]`);
    console.log(`    masteryScore=${m.masteryScore?.toFixed(1)} decayedMastery=${m.decayedMastery?.toFixed(1)} evidenceCount=${m.evidenceCount} direct=${m.directEvidenceCount} activationState=${m.activationState}`);
    console.log(`    halfLifeDays=${m.halfLifeDays} lastEvidenceAt=${m.lastEvidenceAt?.toISOString() ?? "null"}`);
    console.log(`    incidental: taskTypes=[${spacing.types.join(", ")}] (count=${spacing.types.length}) confidences=[${spacing.confidences.map((c) => c.toFixed(2)).join(", ")}] (median=${med.toFixed(2)})`);
    console.log(`    candidateReady = confidences>=3 (${spacing.confidences.length}) AND taskTypes>=2 (${spacing.types.length}) AND medianConf>=0.7 (${med.toFixed(2)}) => ${candidateReady}`);
    console.log("");
  }

  if (filterWords.length > 0) {
    const vocabByDesc = await prisma.gseNode.findMany({
      where: {
        type: "GSE_VOCAB",
        OR: filterWords.map((w) => ({ descriptor: { contains: w, mode: "insensitive" as const } })),
      },
      select: { nodeId: true, descriptor: true },
    });
    console.log("=== GSE vocab nodes matching filter words ===");
    for (const n of vocabByDesc) console.log(`  ${n.nodeId}  descriptor="${n.descriptor}"`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

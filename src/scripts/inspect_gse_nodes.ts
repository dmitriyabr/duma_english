/**
 * One-off: real GSE nodes in stage range — full descriptors, counts by type, bundle composition.
 * Run: npx tsx src/scripts/inspect_gse_nodes.ts
 */
import "dotenv/config";
import { prisma } from "../lib/db";
import { mapStageToGseRange } from "../lib/gse/utils";
import { getBundleNodeIdsForStage } from "../lib/gse/bundles";

async function main() {
  const stage = "A2";
  const range = mapStageToGseRange(stage);
  const min = range.min - 3;
  const max = range.max + 3;

  const [countsInRange, vocabSample, grammarSample, loSample, bundleA2] = await Promise.all([
    prisma.gseNode.groupBy({
      by: ["type"],
      where: { gseCenter: { gte: min, lte: max } },
      _count: { nodeId: true },
    }),
    prisma.gseNode.findMany({
      where: { type: "GSE_VOCAB", gseCenter: { gte: min, lte: max } },
      select: { nodeId: true, descriptor: true, sourceKey: true, gseCenter: true, skill: true },
      take: 12,
      orderBy: [{ gseCenter: "asc" }, { nodeId: "asc" }],
    }),
    prisma.gseNode.findMany({
      where: { type: "GSE_GRAMMAR", gseCenter: { gte: min, lte: max } },
      select: { nodeId: true, descriptor: true, sourceKey: true, gseCenter: true, skill: true },
      take: 12,
      orderBy: [{ gseCenter: "asc" }, { nodeId: "asc" }],
    }),
    prisma.gseNode.findMany({
      where: { type: "GSE_LO", gseCenter: { gte: min, lte: max } },
      select: { nodeId: true, descriptor: true, sourceKey: true, gseCenter: true, skill: true },
      take: 12,
      orderBy: [{ gseCenter: "asc" }, { nodeId: "asc" }],
    }),
    getBundleNodeIdsForStage(stage),
  ]);

  const bundleNodeIds = new Set(bundleA2);
  const bundleNodes = await prisma.gseNode.findMany({
    where: { nodeId: { in: [...bundleNodeIds] } },
    select: { nodeId: true, type: true, descriptor: true, gseCenter: true },
  });
  const bundleByType = { GSE_VOCAB: 0, GSE_GRAMMAR: 0, GSE_LO: 0 };
  for (const n of bundleNodes) {
    if (n.type === "GSE_VOCAB") bundleByType.GSE_VOCAB += 1;
    else if (n.type === "GSE_GRAMMAR") bundleByType.GSE_GRAMMAR += 1;
    else bundleByType.GSE_LO += 1;
  }

  console.log(`\n=== Stage ${stage} range gseCenter [${min}, ${max}] ===\n`);
  console.log("Counts in range by type:");
  countsInRange.forEach((c) => console.log(`  ${c.type}: ${c._count.nodeId}`));
  console.log("\nBundle for", stage, "total nodes:", bundleA2.length);
  console.log("Bundle by type:", bundleByType);

  console.log("\n--- GSE_VOCAB in range (full descriptor) ---\n");
  for (const n of vocabSample) {
    console.log(`  gseCenter: ${n.gseCenter}  skill: ${n.skill ?? "—"}`);
    console.log(`  descriptor: ${n.descriptor ?? "(empty)"}`);
    console.log(`  sourceKey: ${n.sourceKey ?? "—"}`);
    console.log("");
  }

  console.log("\n--- GSE_GRAMMAR in range (full descriptor) ---\n");
  for (const n of grammarSample) {
    console.log(`  gseCenter: ${n.gseCenter}  skill: ${n.skill ?? "—"}`);
    console.log(`  descriptor: ${n.descriptor ?? "(empty)"}`);
    console.log(`  sourceKey: ${n.sourceKey ?? "—"}`);
    console.log("");
  }

  console.log("\n--- GSE_LO in range (full descriptor) ---\n");
  for (const n of loSample) {
    console.log(`  gseCenter: ${n.gseCenter}  skill: ${n.skill ?? "—"}`);
    console.log(`  descriptor: ${n.descriptor ?? "(empty)"}`);
    console.log(`  sourceKey: ${n.sourceKey ?? "—"}`);
    console.log("");
  }

  console.log("\n--- Sample bundle nodes (mix) ---\n");
  const shown = bundleNodes.slice(0, 15);
  for (const n of shown) {
    const desc = (n.descriptor ?? "").length > 100 ? (n.descriptor ?? "").slice(0, 100) + "…" : (n.descriptor ?? "");
    console.log(`  [${n.type}] gseCenter: ${n.gseCenter}`);
    console.log(`  ${desc}`);
    console.log("");
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

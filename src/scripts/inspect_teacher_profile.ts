/**
 * Inspect a student profile: why 0 nodes closed, node vs task words, exact 17% breakdown.
 * Run: npx tsx src/scripts/inspect_teacher_profile.ts [studentId]
 * If no studentId: uses the student with the most recent completed attempt.
 */
import "dotenv/config";
import { prisma } from "../lib/db";
import { computeStageBundleReadiness } from "../lib/gse/bundles";
import { projectLearnerStageFromGse } from "../lib/gse/stageProjection";

const RELIABILITY_THRESHOLD = 0.65;

async function main() {
  const studentId = process.argv[2];
  let sid = studentId;
  if (!sid) {
    const latest = await prisma.attempt.findFirst({
      where: { status: "completed" },
      orderBy: { completedAt: "desc" },
      select: { studentId: true },
    });
    if (!latest) {
      console.log("No completed attempts. Pass studentId: npx tsx src/scripts/inspect_teacher_profile.ts <studentId>");
      process.exit(1);
    }
    sid = latest.studentId;
    console.log("Using student with most recent attempt:", sid.slice(0, 12) + "...\n");
  }

  const student = await prisma.student.findUnique({
    where: { id: sid },
    select: { id: true, displayName: true, classId: true },
  });
  if (!student) {
    console.log("Student not found:", sid);
    process.exit(1);
  }

  const projection = await projectLearnerStageFromGse(sid);
  const bundleReadiness = await computeStageBundleReadiness(sid);
  const targetStage = projection.targetStage;
  const targetRow = bundleReadiness.stageRows.find((r) => r.stage === targetStage);

  console.log("=== 0) Your stage (why A2?) ===\n");
  console.log("  Placement (evidence-weighted level):", projection.placementStage, `(confidence ${(projection.placementConfidence * 100).toFixed(0)}%)`);
  console.log("  Promotion (current level shown in UI):", projection.promotionStage);
  console.log("  Target (next level):", projection.targetStage);
  if (projection.placementStage !== projection.promotionStage) {
    const order = ["A0", "A1", "A2", "B1", "B2", "C1", "C2"];
    const pIdx = order.indexOf(projection.placementStage);
    const bIdx = order.indexOf(projection.promotionStage);
    if (pIdx > bIdx) {
      console.log("  → Promotion was LIFTED to placement (you show skills from higher-level nodes, so we don't show a lower level).");
    }
  }
  console.log("\n  Node coverage by band (mastered = value≥80):");
  const bands = projection.nodeCoverageByBand ?? {};
  for (const [band, stat] of Object.entries(bands)) {
    console.log(`    ${band}: ${stat.mastered}/${stat.total} mastered`);
  }
  console.log("");

  console.log("=== 1) Why 0 nodes closed? ===\n");
  console.log("Target stage:", targetStage);
  console.log("A node counts as 'closed' for promotion when: verified AND mastery value >= 70.\n");

  if (targetRow) {
    for (const bundle of targetRow.bundleRows) {
      console.log(`Bundle: ${bundle.title} (${bundle.domain})`);
      console.log(`  Closed (verified & value≥70): ${bundle.coveredCount} / ${bundle.totalRequired}`);
      if (bundle.coveredCount === 0 && bundle.blockers.length > 0) {
        console.log(
          "  Sample blockers (not verified or value<60):",
          bundle.blockers.slice(0, 3).map((b) => `${b.descriptor?.slice(0, 45)} → ${b.value.toFixed(0)}`).join(" | ")
        );
      }
      console.log("");
    }
  }

  console.log("=== 2) Why nodes in UI differ from words in tasks? ===\n");
  console.log("Two different sources:");
  console.log("  • Blocking nodes (Path to next level) = target-stage bundle nodes from GSE catalog (e.g. 'Can say their age using I'm [number]').");
  console.log("  • Words in tasks (target_vocab) = from StudentVocabulary (spaced repetition: new/learning lemmas), e.g. 'play', 'feel'.");
  console.log("  • For target_vocab, requiredWords and prompt words come from the planner's target node descriptors (so we only penalize for words we asked for). See DEBUG_PLAYBOOK § E5.");
  console.log("So you see target-stage Grammar/Can-Do descriptors in the block, but tasks may use different vocab words from your vocabulary queue.\n");

  const lastTasks = await prisma.taskInstance.findMany({
    where: { studentId: sid },
    orderBy: { createdAt: "desc" },
    take: 3,
    include: { task: { select: { type: true, prompt: true, metaJson: true } } },
  });
  const nodeIds = [...new Set(lastTasks.flatMap((t) => t.targetNodeIds ?? []))];
  const nodes = await prisma.gseNode.findMany({
    where: { nodeId: { in: nodeIds } },
    select: { nodeId: true, descriptor: true },
  });
  const nodeMap = new Map(nodes.map((n) => [n.nodeId, n.descriptor]));

  for (const ti of lastTasks) {
    const task = ti.task;
    const meta = (task?.metaJson || {}) as { requiredWords?: string[] };
    const requiredWords = Array.isArray(meta.requiredWords) ? meta.requiredWords : [];
    const targetDescs = (ti.targetNodeIds ?? []).map((id) => nodeMap.get(id) ?? id).slice(0, 4);
    console.log(`Task ${task?.type ?? "?"}:`);
    console.log("  Target node descriptors:", targetDescs.join(" | "));
    console.log("  requiredWords in meta:", requiredWords.length ? requiredWords.join(", ") : "none");
    console.log("");
  }

  console.log("=== 3) Exact 17% breakdown ===\n");
  const coverage = targetRow?.coverage ?? 0;
  const reliability = targetRow?.reliability ?? 0;
  const stability = targetRow?.stability ?? 0;
  const confidence = projection.confidence;
  const confidencePart = Math.min(10, Math.round(confidence * 10));

  const coveragePart = coverage * 60;
  const reliabilityPart = reliability >= RELIABILITY_THRESHOLD ? 20 : 8;
  const stabilityPart = stability >= 0.5 ? 10 : 3;
  const total = coveragePart + reliabilityPart + stabilityPart + confidencePart;

  console.log("  coverage (nodes at 70+ verified) * 60  =", Number(coveragePart.toFixed(1)));
  console.log("  reliability >= 0.65 ? 20 : 8          =", reliabilityPart, `(your reliability: ${(reliability * 100).toFixed(1)}%)`);
  console.log("  stability >= 0.5 ? 10 : 3               =", stabilityPart, `(your stability: ${(stability * 100).toFixed(1)}%)`);
  console.log("  min(10, round(confidence*10))           =", confidencePart, `(confidence: ${(confidence * 100).toFixed(0)}%)`);
  console.log("  ----------------------------------------");
  console.log("  Total readiness score                  =", Number(total.toFixed(1)), "(capped to 100)");
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

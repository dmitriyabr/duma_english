/**
 * One-off: inspect recent tasks, attempts, evidence and mastery to debug "no skill progress".
 * Run: npx tsx src/scripts/inspect_recent_tasks.ts
 */
import "dotenv/config";
import { prisma } from "../lib/db";

async function main() {
  const recentAttempts = await prisma.attempt.findMany({
    where: { status: "completed" },
    orderBy: { completedAt: "desc" },
    take: 20,
    include: {
      task: { select: { id: true, type: true, prompt: true } },
      gseEvidence: { select: { id: true, nodeId: true, signalType: true, score: true, targeted: true, domain: true } },
    },
  });

  const studentIds = [...new Set(recentAttempts.map((a) => a.studentId))];
  const taskIds = recentAttempts.map((a) => a.taskId);

  const taskInstances = await prisma.taskInstance.findMany({
    where: { taskId: { in: taskIds } },
    select: { taskId: true, targetNodeIds: true, taskType: true },
  });
  const targetsByTask = Object.fromEntries(taskInstances.map((t) => [t.taskId, t.targetNodeIds]));

  console.log("=== Last 20 COMPLETED attempts ===\n");
  for (const a of recentAttempts) {
    const targets = targetsByTask[a.taskId] ?? [];
    const evCount = a.gseEvidence.length;
    const taskEval = (a.taskEvaluationJson || {}) as { taskScore?: number };
    console.log(
      `Attempt ${a.id.slice(0, 8)}.. | student ${a.studentId.slice(0, 8)}.. | ${a.task?.type ?? "?"} | completed ${a.completedAt?.toISOString() ?? "?"}`
    );
    console.log(`  taskScore: ${taskEval.taskScore ?? "n/a"} | targetNodeIds: ${targets.length} | evidence rows: ${evCount}`);
    if (evCount > 0) {
      a.gseEvidence.slice(0, 5).forEach((e) => {
        console.log(`    - ${e.nodeId.slice(0, 36)}.. ${e.signalType} score=${e.score.toFixed(2)} targeted=${e.targeted} ${e.domain ?? ""}`);
      });
      if (a.gseEvidence.length > 5) console.log(`    ... and ${a.gseEvidence.length - 5} more`);
    }
    console.log("");
  }

  if (studentIds.length === 0) {
    console.log("No completed attempts found.");
    return;
  }

  const evidenceCounts = await prisma.attemptGseEvidence.groupBy({
    by: ["studentId"],
    where: { studentId: { in: studentIds } },
    _count: { id: true },
  });
  console.log("=== Evidence count per student ===");
  evidenceCounts.forEach((c) => console.log(`  ${c.studentId}: ${c._count.id} evidence rows`));

  const byKind = await prisma.attemptGseEvidence.groupBy({
    by: ["evidenceKind"],
    where: { studentId: studentIds[0] },
    _count: { id: true },
  });
  console.log("\n=== Evidence by kind (direct = progress; negative = no progress) ===");
  byKind.forEach((c) => console.log(`  ${c.evidenceKind}: ${c._count.id}`));

  const masteryRows = await prisma.studentGseMastery.findMany({
    where: { studentId: studentIds[0] },
    orderBy: { updatedAt: "desc" },
    take: 15,
    select: {
      nodeId: true,
      masteryScore: true,
      decayedMastery: true,
      evidenceCount: true,
      directEvidenceCount: true,
      activationState: true,
      updatedAt: true,
      node: { select: { descriptor: true } },
    },
  });
  console.log(`\n=== StudentGseMastery (latest 15 for student ${studentIds[0].slice(0, 8)}..) ===`);
  masteryRows.forEach((m) => {
    console.log(
      `  ${m.node.descriptor?.slice(0, 50) ?? m.nodeId} | score=${m.masteryScore?.toFixed(1) ?? "?"} decayed=${m.decayedMastery?.toFixed(1) ?? "?"} evidence=${m.evidenceCount} direct=${m.directEvidenceCount} state=${m.activationState} updated=${m.updatedAt.toISOString()}`
    );
  });

  const attemptsWithoutEvidence = recentAttempts.filter((a) => a.gseEvidence.length === 0);
  if (attemptsWithoutEvidence.length > 0) {
    console.log(`\n!!! ${attemptsWithoutEvidence.length} attempts have 0 evidence rows (worker may not have run or evidence pipeline returned 0)`);
    const sample = attemptsWithoutEvidence[0];
    const hasNodeOutcomes = !!sample.nodeOutcomesJson;
    console.log(`  Sample attempt ${sample.id}: nodeOutcomesJson present = ${hasNodeOutcomes}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

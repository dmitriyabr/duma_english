/**
 * Почему балл по ноде упал: все доказательства по этой ноде по времени.
 * Run: npx tsx src/scripts/why_node_score_dropped.ts [descriptor]
 * Example: npx tsx src/scripts/why_node_score_dropped.ts feel
 */
import "dotenv/config";
import { prisma } from "../lib/db";

async function main() {
  const descriptorFilter = process.argv[2]?.toLowerCase() || "feel";

  const node = await prisma.gseNode.findFirst({
    where: {
      type: "GSE_VOCAB",
      descriptor: { equals: descriptorFilter, mode: "insensitive" },
    },
    select: { nodeId: true, descriptor: true },
  });
  if (!node) {
    console.log(`No GSE_VOCAB node with descriptor="${descriptorFilter}"`);
    return;
  }

  const lastAttempt = await prisma.attempt.findFirst({
    where: { status: "completed" },
    orderBy: { completedAt: "desc" },
    select: { studentId: true },
  });
  if (!lastAttempt) {
    console.log("No completed attempt.");
    return;
  }

  const evidence = await prisma.attemptGseEvidence.findMany({
    where: { studentId: lastAttempt.studentId, nodeId: node.nodeId },
    orderBy: { createdAt: "asc" },
    include: {
      attempt: {
        select: {
          id: true,
          completedAt: true,
          task: { select: { type: true } },
        },
      },
    },
  });

  const mastery = await prisma.studentGseMastery.findUnique({
    where: {
      studentId_nodeId: { studentId: lastAttempt.studentId, nodeId: node.nodeId },
    },
    select: { masteryScore: true, decayedMastery: true, evidenceCount: true, directEvidenceCount: true },
  });

  console.log(`Node: ${node.descriptor} (${node.nodeId})`);
  console.log(`Student: ${lastAttempt.studentId}`);
  console.log(`Mastery now: score=${mastery?.masteryScore} decayed=${mastery?.decayedMastery} evidenceCount=${mastery?.evidenceCount} direct=${mastery?.directEvidenceCount}`);
  console.log(`\nTotal evidence rows: ${evidence.length}\n=== All evidence in chronological order ===\n`);

  for (let i = 0; i < evidence.length; i++) {
    const e = evidence[i];
    console.log(
      `${i + 1}. ${e.attempt.completedAt?.toISOString()} | ${e.attempt.task?.type} | signalType=${e.signalType} evidenceKind=${e.evidenceKind} score=${e.score.toFixed(2)} confidence=${e.confidence.toFixed(2)} targeted=${e.targeted}`
    );
  }

  if (evidence.length === 1 && (mastery?.evidenceCount ?? 0) >= 2) {
    console.log("\n>>> evidenceCount в mastery = " + mastery?.evidenceCount + ", а в таблице AttemptGseEvidence строк для этой ноды = " + evidence.length + ". Значит одно доказательство было применено из попытки, которой или доказательств которой уже нет в БД (удалено). То, что понизило балл с ~76 до 69.5, в базе не сохранилось.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

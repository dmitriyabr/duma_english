import "dotenv/config";
import { prisma } from "../src/lib/db";

async function main() {
  const sessionId = "cmli1rpz900065xl9m8ldkdex";
  const studentId = "cmli1eupd00015xl9ectgx1jo";

  // Session info
  const session = await prisma.placementSession.findUnique({
    where: { id: sessionId },
    select: { stageHistory: true, stageEstimate: true, theta: true, sigma: true, transcriptHistory: true },
  });
  console.log("=== SESSION ===");
  console.log("stageHistory:", session?.stageHistory);
  console.log("stageEstimate:", session?.stageEstimate);
  console.log("theta:", session?.theta, "sigma:", session?.sigma);
  const th = session?.transcriptHistory as string[] | null;
  console.log("transcriptHistory entries:", th?.length || 0);

  // All attempts with evidence
  const attempts = await prisma.attempt.findMany({
    where: { task: { metaJson: { path: ["placementSessionId"], equals: sessionId } } },
    orderBy: { createdAt: "asc" },
    include: {
      task: { select: { type: true, metaJson: true, prompt: true } },
      gseEvidence: {
        include: { node: { select: { nodeId: true, type: true, descriptor: true, gseCenter: true } } },
      },
    },
  });

  for (const a of attempts) {
    const meta = a.task.metaJson as Record<string, unknown>;
    console.log("\n=== ATTEMPT", a.id, "===");
    console.log("stage:", meta.stage, "scaffolding:", meta.scaffoldingLevel, "attemptNum:", meta.placementAttemptNumber);
    console.log("prompt:", a.task.prompt?.slice(0, 150));
    console.log("transcript:", (a.transcript || "").slice(0, 250));
    console.log("word count:", (a.transcript || "").split(/\s+/).filter(Boolean).length);
    console.log("evidence rows:", a.gseEvidence.length);

    // Group evidence by type and domain
    const byDomain: Record<string, number> = {};
    const byKind: Record<string, number> = {};
    const b1plus: string[] = [];
    for (const e of a.gseEvidence) {
      const domain = e.node.type;
      const kind = e.evidenceKind;
      byDomain[domain] = (byDomain[domain] || 0) + 1;
      byKind[kind] = (byKind[kind] || 0) + 1;
      const gse = e.node.gseCenter;
      if (gse !== null && gse >= 43) {
        b1plus.push(`${e.node.descriptor.slice(0, 45)} (gse=${gse} ${kind} conf=${e.confidence})`);
      }
    }
    console.log("by domain:", byDomain);
    console.log("by kind:", byKind);
    if (b1plus.length > 0) {
      console.log("B1+ evidence:");
      for (const e of b1plus) console.log("  ", e);
    } else {
      console.log("B1+ evidence: NONE");
    }
  }

  // Stage projection
  const proj = await prisma.gseStageProjection.findFirst({
    where: { studentId },
    orderBy: { createdAt: "desc" },
  });
  console.log("\n=== STAGE PROJECTION ===");
  if (proj) {
    const ej = proj.evidenceJson as Record<string, unknown> | null;
    console.log("stage:", proj.stage, "placementStage:", ej?.placementStage, "promotionStage:", ej?.promotionStage);
    console.log("createdAt:", proj.createdAt);
  } else {
    console.log("No projection yet");
  }

  // Mastery nodes at B1+ level
  const mastery = await prisma.studentGseMastery.findMany({
    where: { studentId, node: { gseCenter: { gte: 43 } } },
    include: { node: { select: { descriptor: true, gseCenter: true, type: true } } },
    orderBy: { decayedMastery: "desc" },
    take: 20,
  });
  console.log("\n=== B1+ MASTERY NODES (top 20) ===");
  for (const m of mastery) {
    console.log(`  mastery=${(m.decayedMastery ?? 0).toFixed(2)} a=${m.alpha.toFixed(1)} b=${m.beta.toFixed(1)} ${m.node.type.slice(4)} gse=${m.node.gseCenter} "${m.node.descriptor.slice(0, 50)}"`);
  }

  // Total mastery nodes
  const totalMastery = await prisma.studentGseMastery.count({ where: { studentId } });
  const b1Count = await prisma.studentGseMastery.count({ where: { studentId, node: { gseCenter: { gte: 43 } } } });
  console.log(`\nTotal mastery nodes: ${totalMastery}, B1+: ${b1Count}`);
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

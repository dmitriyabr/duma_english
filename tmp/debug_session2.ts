import "dotenv/config";
import { prisma } from "../src/lib/db";

async function main() {
  const studentId = "cmli1eupd00015xl9ectgx1jo";

  // Stage projection
  const proj = await prisma.gseStageProjection.findFirst({
    where: { studentId },
    orderBy: { createdAt: "desc" },
  });
  console.log("=== STAGE PROJECTION ===");
  if (proj) {
    console.log("stage:", proj.stage, "stageScore:", proj.stageScore, "confidence:", proj.confidence);
    console.log("source:", proj.source, "reason:", proj.reason);
    console.log("createdAt:", proj.createdAt);
  } else {
    console.log("No projection yet");
  }

  // All projections
  const allProj = await prisma.gseStageProjection.findMany({
    where: { studentId },
    orderBy: { createdAt: "asc" },
  });
  console.log("\nAll projections:", allProj.length);
  for (const p of allProj) {
    console.log(`  stage=${p.stage} score=${p.stageScore} conf=${p.confidence} source=${p.source} reason=${(p.reason || "").slice(0, 80)}`);
  }

  // All evidence with details
  const evidence = await prisma.attemptGseEvidence.findMany({
    where: { attempt: { studentId } },
    include: { node: { select: { type: true, descriptor: true, gseCenter: true } } },
    orderBy: { createdAt: "asc" },
  });
  console.log("\n=== ALL EVIDENCE ===");
  console.log("Total rows:", evidence.length);

  // Group by gse band
  const bands: Record<string, number> = {};
  for (const e of evidence) {
    const gse = e.node.gseCenter;
    let band = "unknown";
    if (gse !== null) {
      if (gse <= 29) band = "A1";
      else if (gse <= 42) band = "A2";
      else if (gse <= 58) band = "B1";
      else if (gse <= 75) band = "B2";
      else if (gse <= 84) band = "C1";
      else band = "C2";
    }
    bands[band] = (bands[band] || 0) + 1;
  }
  console.log("Evidence by GSE band:", bands);

  // Show all B1+ evidence
  console.log("\nB1+ evidence details:");
  for (const e of evidence) {
    const gse = e.node.gseCenter;
    if (gse !== null && gse >= 43) {
      console.log(`  gse=${gse} ${e.node.type.slice(4).padEnd(8)} kind=${e.evidenceKind.padEnd(12)} score=${e.score} conf=${e.confidence} "${e.node.descriptor.slice(0, 45)}"`);
    }
  }

  // B1+ mastery
  const mastery = await prisma.studentGseMastery.findMany({
    where: { studentId, node: { gseCenter: { gte: 43 } } },
    include: { node: { select: { descriptor: true, gseCenter: true, type: true } } },
    orderBy: { decayedMastery: "desc" },
    take: 20,
  });
  console.log("\n=== B1+ MASTERY (top 20) ===");
  for (const m of mastery) {
    console.log(`  m=${(m.decayedMastery ?? 0).toFixed(2)} a=${m.alpha.toFixed(1)} b=${m.beta.toFixed(1)} ${m.activationState.padEnd(25)} ${m.node.type.slice(4).padEnd(8)} gse=${m.node.gseCenter} "${m.node.descriptor.slice(0, 45)}"`);
  }
  const totalMastery = await prisma.studentGseMastery.count({ where: { studentId } });
  const b1Count = await prisma.studentGseMastery.count({ where: { studentId, node: { gseCenter: { gte: 43 } } } });
  console.log(`\nTotal mastery: ${totalMastery}, B1+: ${b1Count}`);
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

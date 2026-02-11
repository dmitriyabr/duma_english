import "dotenv/config";
import { prisma } from "../src/lib/db";
import { gseBandFromCenter, projectLearnerStageFromGse } from "../src/lib/gse/stageProjection";

const STAGES = ["A0", "A1", "A2", "B1", "B2", "C1", "C2"] as const;
function stageIndex(stage: string) {
  const idx = STAGES.indexOf(stage as (typeof STAGES)[number]);
  return idx === -1 ? 0 : idx;
}

async function analyzeLastAttemptNodes(attemptId: string) {
  const evidence = await prisma.attemptGseEvidence.findMany({
    where: { attemptId, score: { gte: 0.5 } },
    include: { node: { select: { gseCenter: true } } },
  });

  const distribution: Record<string, number> = {};
  for (const row of evidence) {
    const stage = gseBandFromCenter(row.node.gseCenter);
    distribution[stage] = (distribution[stage] || 0) + 1;
  }

  if (evidence.length === 0) {
    return { stageDistribution: {}, dominantStage: "A1", highestObservedStage: "A1", totalNodes: 0 };
  }

  let dominantStage = "A1";
  let maxCount = 0;
  for (const [stage, count] of Object.entries(distribution)) {
    if (count > maxCount) {
      maxCount = count;
      dominantStage = stage;
    }
  }

  const observedStages = Object.keys(distribution);
  const highestObservedStage = observedStages.reduce((highest, stage) =>
    stageIndex(stage) > stageIndex(highest) ? stage : highest
  , "A0");

  return { stageDistribution: distribution, dominantStage, highestObservedStage, totalNodes: evidence.length };
}

async function main() {
  const sessionId = "cmli1rpz900065xl9m8ldkdex";
  const studentId = "cmli1eupd00015xl9ectgx1jo";

  const attempts = await prisma.attempt.findMany({
    where: { task: { metaJson: { path: ["placementSessionId"], equals: sessionId } } },
    orderBy: { createdAt: "asc" },
    include: { task: { select: { metaJson: true } } },
  });

  console.log("=== TRACING SUBMIT FLOW FOR EACH ATTEMPT ===\n");

  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i];
    const meta = a.task.metaJson as Record<string, unknown>;
    console.log(`--- After attempt ${i + 1} (${a.id}) stage=${meta.stage} ---`);

    const nodeAnalysis = await analyzeLastAttemptNodes(a.id);
    console.log("  nodeAnalysis:", JSON.stringify(nodeAnalysis.stageDistribution));
    console.log("  dominantStage:", nodeAnalysis.dominantStage);
    console.log("  highestObservedStage:", nodeAnalysis.highestObservedStage);
    console.log("  totalNodes:", nodeAnalysis.totalNodes);

    const projection = await projectLearnerStageFromGse(studentId);
    console.log("  projection.placementStage:", projection.placementStage);
    console.log("  projection.promotionStage:", projection.promotionStage);

    const projectedStage = (projection.placementStage as string) || "A2";
    const previousTaskStage = typeof meta.stage === "string" ? meta.stage : undefined;

    // Simulate what questionCount would be at this point
    // questionCount starts at 0, incremented before determineTargetStage
    const questionCountAfterUpdate = i + 1; // 1 for first, 2 for second, etc.
    const attemptNumber = questionCountAfterUpdate + 1;

    console.log("  projectedStage:", projectedStage);
    console.log("  previousTaskStage:", previousTaskStage);
    console.log("  attemptNumber (for next task):", attemptNumber);

    // Trace determineTargetStage
    const prevIdx = stageIndex(previousTaskStage || projectedStage);
    const projIdx = stageIndex(projectedStage);
    console.log("  prevIdx:", prevIdx, "projIdx:", projIdx);

    if (attemptNumber <= 2) {
      const observedIdx = stageIndex(nodeAnalysis.highestObservedStage);
      const target = Math.min(Math.max(projIdx, observedIdx), projIdx + 1);
      console.log("  [attemptNumber<=2] observedIdx:", observedIdx, "target:", target, "→", STAGES[target]);
    } else {
      const observedIdx = stageIndex(nodeAnalysis.highestObservedStage);
      const domIdx = stageIndex(nodeAnalysis.dominantStage);
      console.log("  [attemptNumber>2] observedIdx:", observedIdx, "domIdx:", domIdx);
      // scaffolding for attempt 3+ would be "minimal" if no feedback
      const candidateIdx = domIdx; // minimal scaffolding
      const capped = Math.min(candidateIdx, prevIdx + 1);
      const result = STAGES[Math.max(0, Math.min(capped, STAGES.length - 1))];
      console.log("  candidateIdx:", candidateIdx, "capped:", capped, "→", result);
    }
    console.log("");
  }
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

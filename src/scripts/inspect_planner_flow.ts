/**
 * Откуда берутся ноды для заданий: stage из базы, пул нод (loadNodeState), ноды из бандла B1, последние выдачи.
 * Run: npx tsx src/scripts/inspect_planner_flow.ts [studentId]
 */
import "dotenv/config";
import { prisma } from "../lib/db";
import { projectLearnerStageFromGse } from "../lib/gse/stageProjection";
import { getBundleNodeIdsForStage } from "../lib/gse/bundles";
import { mapStageToGseRange } from "../lib/gse/utils";

async function main() {
  let studentId = process.argv[2];
  if (!studentId) {
    const latest = await prisma.attempt.findFirst({
      where: { status: "completed" },
      orderBy: { completedAt: "desc" },
      select: { studentId: true },
    });
    if (!latest) {
      console.log("No attempts. Pass studentId.");
      process.exit(1);
    }
    studentId = latest.studentId;
    console.log("Student (last attempt):", studentId, "\n");
  }

  const projection = await projectLearnerStageFromGse(studentId);
  const promotionStage = projection.promotionStage;
  const targetStage = projection.targetStage;
  const stageRange = mapStageToGseRange(promotionStage);

  console.log("=== 1) Stage из базы (не «судя») ===\n");
  console.log("  promotionStage (текущий уровень):", promotionStage);
  console.log("  targetStage (куда прогресс):", targetStage);
  console.log("  GSE диапазон для", promotionStage, ":", stageRange.min, "-", stageRange.max);
  console.log("");

  const b1BundleNodeIds = await getBundleNodeIdsForStage(targetStage as "B1");
  console.log("=== 2) Ноды бандлов целевого стейджа (B1) ===\n");
  console.log("  Всего нод в бандлах B1 (обязательные):", b1BundleNodeIds.length);
  const b1Nodes = await prisma.gseNode.findMany({
    where: { nodeId: { in: b1BundleNodeIds.slice(0, 30) } },
    select: { nodeId: true, descriptor: true, gseCenter: true },
  });
  console.log("  Примеры (первые 10):");
  b1Nodes.slice(0, 10).forEach((n) => console.log("   ", n.gseCenter, n.descriptor?.slice(0, 50)));
  console.log("");

  const poolMin = stageRange.min - 5;
  const poolMax = stageRange.max + 5;
  const masteryInRange = await prisma.studentGseMastery.findMany({
    where: {
      studentId,
      node: { gseCenter: { gte: poolMin, lte: poolMax } },
    },
    include: { node: { select: { nodeId: true, descriptor: true, gseCenter: true } } },
    take: 50,
  });
  console.log("=== 3) Пул нод (как в loadNodeState) ===\n");
  console.log("  Планировщик грузит ноды с gseCenter в диапазоне", poolMin, "-", poolMax, "(stage", promotionStage, "± 5)");
  console.log("  У тебя записей StudentGseMastery в этом диапазоне:", masteryInRange.length);
  const inB1Bundle = new Set(b1BundleNodeIds);
  const poolNodeIds = masteryInRange.map((r) => r.nodeId);
  const poolIntersectB1 = poolNodeIds.filter((id) => inB1Bundle.has(id));
  console.log("  Из них входят в бандлы B1:", poolIntersectB1.length);
  console.log("  Примеры нод из пула (descriptor, gseCenter):");
  masteryInRange.slice(0, 10).forEach((r) => {
    const inB1 = inB1Bundle.has(r.nodeId) ? " [B1 bundle]" : "";
    console.log("   ", r.node.gseCenter, r.node.descriptor?.slice(0, 45) + inB1);
  });
  console.log("");

  const decisions = await prisma.plannerDecisionLog.findMany({
    where: { studentId },
    orderBy: { decisionTs: "desc" },
    take: 5,
    select: { chosenTaskType: true, targetNodeIds: true, decisionTs: true },
  });
  console.log("=== 4) Последние 5 решений планировщика (какие ноды выданы) ===\n");
  for (const d of decisions) {
    const ids = (d.targetNodeIds ?? []) as string[];
    const nodes = await prisma.gseNode.findMany({
      where: { nodeId: { in: ids } },
      select: { nodeId: true, descriptor: true, gseCenter: true },
    });
    const inB1 = ids.filter((id) => inB1Bundle.has(id)).length;
    console.log("  ", d.decisionTs?.toISOString(), "|", d.chosenTaskType, "| target нод:", ids.length, "| из них в бандле B1:", inB1);
    nodes.forEach((n) => console.log("     ", n.gseCenter, n.descriptor?.slice(0, 50)));
  }
  console.log("");

  console.log("=== 5) Итог ===\n");
  const allChosenIds = [...new Set(decisions.flatMap((d) => (d.targetNodeIds ?? []) as string[]))];
  const chosenInB1 = allChosenIds.filter((id) => inB1Bundle.has(id));
  console.log("  Уникальных нод в последних 5 заданиях:", allChosenIds.length);
  console.log("  Из них входят в бандлы B1:", chosenInB1.length);
  if (chosenInB1.length === 0) {
    console.log("  → Тебе не дают ноды из бандлов B1. Node progress к B1 = 0% потому что по этим нодам нет evidence.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

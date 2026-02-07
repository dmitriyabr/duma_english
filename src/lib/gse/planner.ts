import { prisma } from "@/lib/db";
import { mapStageToGseRange } from "./utils";

function skillHintsForTaskType(taskType: string) {
  if (taskType === "read_aloud") return ["speaking", "grammar"];
  if (taskType === "target_vocab") return ["vocabulary", "speaking"];
  if (taskType === "filler_control") return ["speaking"];
  if (taskType === "qa_prompt") return ["speaking", "writing"];
  if (taskType === "role_play") return ["speaking", "listening"];
  if (taskType === "speech_builder") return ["speaking"];
  return ["speaking", "vocabulary"];
}

export async function assignTaskTargetsFromCatalog(params: {
  taskId: string;
  stage: string;
  taskType: string;
  ageBand?: string | null;
  studentId?: string;
}) {
  const stageRange = mapStageToGseRange(params.stage || "A1");
  const audience = params.ageBand === "6-8" || params.ageBand === "9-11" || params.ageBand === "12-14" ? "YL" : "AL";
  const skills = skillHintsForTaskType(params.taskType);

  let candidateNodes: Array<{
    nodeId: string;
    descriptor: string;
    gseCenter: number | null;
    skill: string | null;
  }> = [];
  if (params.studentId) {
    const weakest = await prisma.studentGseMastery.findMany({
      where: {
        studentId: params.studentId,
        node: {
          audience: { in: [audience, "AL", "AE"] },
          skill: { in: skills },
          gseCenter: { gte: stageRange.min - 3, lte: stageRange.max + 3 },
        },
      },
      include: {
        node: {
          select: {
            nodeId: true,
            descriptor: true,
            gseCenter: true,
            skill: true,
          },
        },
      },
      orderBy: { masteryScore: "asc" },
      take: 8,
    });
    candidateNodes = weakest.map((row) => row.node);
  }

  if (candidateNodes.length === 0) {
    candidateNodes = await prisma.gseNode.findMany({
      where: {
        audience: { in: [audience, "AL", "AE"] },
        skill: { in: skills },
        gseCenter: {
          gte: stageRange.min - 3,
          lte: stageRange.max + 3,
        },
      },
      orderBy: [{ gseCenter: "asc" }, { updatedAt: "desc" }],
      take: 12,
      select: {
        nodeId: true,
        descriptor: true,
        gseCenter: true,
        skill: true,
      },
    });
  }

  const selected = candidateNodes.slice(0, 3);
  if (selected.length > 0) {
    await prisma.taskGseTarget.createMany({
      data: selected.map((node, index) => ({
        taskId: params.taskId,
        nodeId: node.nodeId,
        weight: index === 0 ? 1 : 0.7,
        required: index === 0,
      })),
      skipDuplicates: true,
    });
  }

  const targetNodeIds = selected.map((node) => node.nodeId);
  const selectionReason =
    targetNodeIds.length > 0
      ? `Selected ${targetNodeIds.length} GSE nodes for ${params.taskType} at ${params.stage}${params.studentId ? " using weakest-node targeting" : ""}.`
      : "No matching GSE nodes found for current stage; fallback to skill planner.";

  return { targetNodeIds, selectionReason };
}

export async function nextTargetNodesForStudent(studentId: string, limit = 3) {
  const rows = await prisma.studentGseMastery.findMany({
    where: { studentId },
    orderBy: [{ masteryScore: "asc" }, { updatedAt: "asc" }],
    take: limit,
    include: {
      node: {
        select: { nodeId: true, descriptor: true, gseCenter: true, skill: true, audience: true },
      },
    },
  });
  return rows.map((row) => ({
    nodeId: row.nodeId,
    descriptor: row.node.descriptor,
    skill: row.node.skill,
    audience: row.node.audience,
    gseCenter: row.node.gseCenter,
    masteryScore: row.masteryScore,
    reliability: row.reliability,
  }));
}

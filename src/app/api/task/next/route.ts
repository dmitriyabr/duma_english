import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getStudentFromRequest } from "@/lib/auth";
import { buildLearningPlan } from "@/lib/adaptive";
import {
  assignTaskTargetsFromCatalog,
  createTaskInstance,
  finalizePlannerDecision,
  planNextTaskDecision,
} from "@/lib/gse/planner";
import { generateTaskSpec } from "@/lib/taskGenerator";

function inferTargetWordsFromPrompt(prompt: string) {
  const text = (prompt || "").trim();
  const match = text.match(
    /use\s+(?:these|those|the)\s+words(?:\s+in\s+(?:your\s+)?(?:short\s+)?(?:talk|answer))?\s*:?\s*([^.\n]+)/i
  );
  const source = match?.[1] || "";
  if (!source) return [] as string[];
  return source
    .split(/,|\band\b/i)
    .map((word) =>
      word
        .trim()
        .toLowerCase()
        .replace(/["'.!?;:()[\]{}]/g, "")
    )
    .filter((word) => /^[a-z][a-z'-]*$/.test(word))
    .slice(0, 20);
}

export async function GET(req: Request) {
  const student = await getStudentFromRequest();
  if (!student) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const requestedType = url.searchParams.get("type");
  const profile = await prisma.learnerProfile.findUnique({
    where: { studentId: student.studentId },
    select: {
      placementFresh: true,
      placementUncertainNodeIds: true,
      placementCarryoverJson: true,
    },
  });
  const placementUncertainNodes = profile?.placementUncertainNodeIds || [];
  const learningPlan = await buildLearningPlan({
    studentId: student.studentId,
    requestedType,
  });
  const plannerStartedAt = Date.now();
  const decision = await planNextTaskDecision({
    studentId: student.studentId,
    stage: learningPlan.currentStage,
    ageBand: learningPlan.ageBand,
    candidateTaskTypes: learningPlan.recommendedTaskTypes,
    requestedType,
    preferredNodeIds: profile?.placementFresh ? placementUncertainNodes : undefined,
  });
  const generated = await generateTaskSpec({
    taskType: decision.chosenTaskType,
    stage: learningPlan.currentStage,
    ageBand: learningPlan.ageBand,
    targetWords: learningPlan.targetWords,
    targetNodeIds: decision.targetNodeIds,
    focusSkills: learningPlan.weakestSkills,
    plannerReason: learningPlan.nextTaskReason,
    primaryGoal: decision.primaryGoal,
  });

  const selectedTaskType = generated.taskType || decision.chosenTaskType;
  const promptTargetWords =
    selectedTaskType === "target_vocab" ? inferTargetWordsFromPrompt(generated.prompt) : [];
  const taskMeta: Record<string, unknown> = {
    stage: learningPlan.currentStage,
    plannerReason: learningPlan.nextTaskReason,
    focusSkills: learningPlan.weakestSkills,
    requiredWords:
      selectedTaskType === "target_vocab"
        ? (promptTargetWords.length > 0 ? promptTargetWords : learningPlan.targetWords)
        : learningPlan.targetWords,
    expectedArtifacts: generated.expectedArtifacts,
    scoringHooks: generated.scoringHooks,
    supportsPronAssessment: selectedTaskType === "read_aloud",
  };
  if (selectedTaskType === "read_aloud") {
    taskMeta.referenceText = generated.prompt
      .replace(/^Read this aloud clearly:\s*/i, "")
      .replace(/['"]/g, "");
  }
  const task = await prisma.task.create({
    data: {
      type: selectedTaskType,
      prompt: generated.prompt,
      level: Math.max(1, Math.round((generated.estimatedDifficulty || decision.estimatedDifficulty) / 20)),
      metaJson: taskMeta as Prisma.InputJsonValue,
    },
  });
  const gseSelection = await assignTaskTargetsFromCatalog({
    taskId: task.id,
    stage: learningPlan.currentStage,
    taskType: selectedTaskType,
    ageBand: learningPlan.ageBand,
    studentId: student.studentId,
    preferredNodeIds: generated.targetNodes.length > 0 ? generated.targetNodes : decision.targetNodeIds,
  });
  await createTaskInstance({
    studentId: student.studentId,
    taskId: task.id,
    decisionId: decision.decisionId,
    taskType: selectedTaskType,
    targetNodeIds: gseSelection.targetNodeIds,
    specJson: {
      taskType: selectedTaskType,
      prompt: generated.prompt,
      constraints: generated.constraints,
      maxDurationSec: generated.maxDurationSec,
      assessmentMode: generated.assessmentMode,
      expectedArtifacts: generated.expectedArtifacts,
      scoringHooks: generated.scoringHooks,
      estimatedDifficulty: generated.estimatedDifficulty,
      targetNodes: gseSelection.targetNodeIds,
      model: generated.model || null,
    } as Prisma.InputJsonValue,
    fallbackUsed: generated.fallbackUsed,
    estimatedDifficulty: generated.estimatedDifficulty,
  });
  await finalizePlannerDecision({
    decisionId: decision.decisionId,
    fallbackUsed: generated.fallbackUsed,
    latencyMs: Date.now() - plannerStartedAt,
  });

  return NextResponse.json({
    taskId: task.id,
    type: task.type,
    prompt: task.prompt,
    assessmentMode: generated.assessmentMode,
    maxDurationSec: generated.maxDurationSec,
    constraints: generated.constraints,
    stage: learningPlan.currentStage,
    ageBand: learningPlan.ageBand,
    reason: learningPlan.nextTaskReason,
    targetSkills: learningPlan.weakestSkills,
    targetWords: learningPlan.targetWords,
    recommendedTaskTypes: learningPlan.recommendedTaskTypes,
    placementFresh: Boolean(profile?.placementFresh),
    placementUncertainNodes,
    carryoverSummary: profile?.placementCarryoverJson || null,
    decisionId: decision.decisionId,
    primaryGoal: decision.primaryGoal,
    difficulty: generated.estimatedDifficulty,
    expectedGain: decision.expectedGain,
    fallbackUsed: generated.fallbackUsed,
    fallbackReason: generated.fallbackReason || null,
    targetNodeIds: gseSelection.targetNodeIds,
    selectionReason: decision.selectionReason || gseSelection.selectionReason,
  });
}

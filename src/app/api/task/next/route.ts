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
import { buildTaskTemplate } from "@/lib/taskTemplates";
import { extractReferenceText, extractRequiredWords } from "@/lib/taskText";

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
  const primaryRecommendedType = learningPlan.recommendedTaskTypes[0] || "topic_talk";
  const candidateTaskTypes = [
    requestedType && requestedType.length > 0 ? requestedType : primaryRecommendedType,
  ];
  const plannerStartedAt = Date.now();
  const decision = await planNextTaskDecision({
    studentId: student.studentId,
    stage: learningPlan.currentStage,
    ageBand: learningPlan.ageBand,
    candidateTaskTypes,
    requestedType,
    preferredNodeIds: profile?.placementFresh ? placementUncertainNodes : undefined,
  });
  const recentTaskInstances = await prisma.taskInstance.findMany({
    where: { studentId: student.studentId },
    include: { task: { select: { prompt: true } } },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  const recentPrompts = recentTaskInstances
    .map((item) => item.task?.prompt || "")
    .filter((value) => value.length > 0);
  const generated = await generateTaskSpec({
    taskType: decision.chosenTaskType,
    stage: learningPlan.currentStage,
    ageBand: learningPlan.ageBand,
    targetWords: decision.chosenTaskType === "target_vocab" ? learningPlan.targetWords : [],
    targetNodeIds: decision.targetNodeIds,
    focusSkills: learningPlan.weakestSkills,
    plannerReason: learningPlan.nextTaskReason,
    primaryGoal: decision.primaryGoal,
    recentPrompts,
  });

  const selectedTaskType = decision.chosenTaskType;
  const effectiveAssessmentMode: "pa" | "stt" = selectedTaskType === "read_aloud" ? "pa" : "stt";
  const durationCap = effectiveAssessmentMode === "pa" ? 30 : 60;
  const effectiveMaxDurationSec = Math.max(10, Math.min(durationCap, generated.maxDurationSec));
  const effectiveConstraints = {
    minSeconds: Math.max(5, Math.min(effectiveMaxDurationSec, generated.constraints.minSeconds)),
    maxSeconds: Math.max(
      10,
      Math.min(effectiveMaxDurationSec, Math.max(generated.constraints.maxSeconds, generated.constraints.minSeconds))
    ),
  };
  let prompt = generated.prompt;
  let promptTargetWords = selectedTaskType === "target_vocab" ? extractRequiredWords(prompt) : [];
  if (selectedTaskType === "target_vocab" && promptTargetWords.length < 2) {
    const fallbackWords = learningPlan.targetWords.slice(0, 6);
    if (fallbackWords.length >= 2) {
      prompt = `Use these words in a short talk: ${fallbackWords.join(", ")}.`;
      promptTargetWords = fallbackWords;
    }
  }
  const referenceText =
    selectedTaskType === "read_aloud" ? extractReferenceText(prompt || generated.prompt) : null;
  if (selectedTaskType === "read_aloud" && !referenceText) {
    const fallbackReadAloud = buildTaskTemplate("read_aloud", {
      stage: learningPlan.currentStage,
      reason: learningPlan.nextTaskReason,
      focusSkills: learningPlan.weakestSkills,
    });
    prompt = fallbackReadAloud.prompt;
  }
  const effectiveReferenceText =
    selectedTaskType === "read_aloud" ? extractReferenceText(prompt || generated.prompt) : null;
  const taskMeta: Record<string, unknown> = {
    stage: learningPlan.currentStage,
    plannerReason: learningPlan.nextTaskReason,
    focusSkills: learningPlan.weakestSkills,
    requiredWords:
      selectedTaskType === "target_vocab"
        ? (promptTargetWords.length > 0 ? promptTargetWords : learningPlan.targetWords)
        : undefined,
    expectedArtifacts: generated.expectedArtifacts,
    scoringHooks: generated.scoringHooks,
    supportsPronAssessment: selectedTaskType === "read_aloud",
    assessmentMode: effectiveAssessmentMode,
    maxDurationSec: effectiveMaxDurationSec,
  };
  if (effectiveReferenceText) {
    taskMeta.referenceText = effectiveReferenceText;
  }
  const task = await prisma.task.create({
    data: {
      type: selectedTaskType,
      prompt,
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
  if (gseSelection.targetNodeIds.length === 0) {
    return NextResponse.json(
      { error: "Planner could not resolve target GSE nodes for this task." },
      { status: 503 }
    );
  }
  await createTaskInstance({
    studentId: student.studentId,
    taskId: task.id,
    decisionId: decision.decisionId,
    taskType: selectedTaskType,
    targetNodeIds: gseSelection.targetNodeIds,
    specJson: {
      taskType: selectedTaskType,
      prompt,
      constraints: effectiveConstraints,
      maxDurationSec: effectiveMaxDurationSec,
      assessmentMode: effectiveAssessmentMode,
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
    assessmentMode: effectiveAssessmentMode,
    maxDurationSec: effectiveMaxDurationSec,
    constraints: effectiveConstraints,
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

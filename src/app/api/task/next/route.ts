import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getStudentFromRequest } from "@/lib/auth";
import {
  assignTaskTargetsFromCatalog,
  createTaskInstance,
  emitPlannerLatencySnapshot,
  finalizePlannerDecision,
  planNextTaskDecision,
} from "@/lib/gse/planner";
import { projectLearnerStageFromGse } from "@/lib/gse/stageProjection";
import { generateTaskSpec } from "@/lib/taskGenerator";
import { buildTaskTemplate } from "@/lib/taskTemplates";
import { extractReferenceText, extractRequiredWords } from "@/lib/taskText";
import { buildGseQualityReport } from "@/lib/gse/quality";

const ALL_TASK_TYPES = [
  "read_aloud",
  "target_vocab",
  "qa_prompt",
  "role_play",
  "topic_talk",
  "filler_control",
  "speech_builder",
];

function normalizePromptText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function similarityToRecent(prompt: string, recentPrompts: string[]) {
  const normalized = normalizePromptText(prompt);
  if (!normalized || recentPrompts.length === 0) return 0;
  const tokens = new Set(normalized.split(" ").filter((v) => v.length > 2));
  if (tokens.size === 0) return 0;
  let best = 0;
  for (const previous of recentPrompts) {
    const prev = normalizePromptText(previous);
    if (!prev) continue;
    const prevTokens = new Set(prev.split(" ").filter((v) => v.length > 2));
    if (prevTokens.size === 0) continue;
    let intersect = 0;
    for (const token of tokens) {
      if (prevTokens.has(token)) intersect += 1;
    }
    const overlap = intersect / Math.max(tokens.size, prevTokens.size);
    if (overlap > best) best = overlap;
  }
  return Number(best.toFixed(3));
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
      ageBand: true,
      placementFresh: true,
      coldStartActive: true,
      coldStartAttempts: true,
      placementUncertainNodeIds: true,
      placementCarryoverJson: true,
    },
  });
  const projection = await projectLearnerStageFromGse(student.studentId);
  const placementUncertainNodes = profile?.placementUncertainNodeIds || [];

  const weakestSkills = projection.derivedSkills
    .filter((item) => item.current !== null)
    .sort((a, b) => (a.current ?? 0) - (b.current ?? 0))
    .slice(0, 2)
    .map((item) => item.skillKey);

  const vocabDue = await prisma.studentVocabulary.findMany({
    where: {
      studentId: student.studentId,
      OR: [{ status: "new" }, { status: "learning", nextReviewAt: { lte: new Date() } }],
    },
    orderBy: [{ nextReviewAt: "asc" }, { updatedAt: "asc" }],
    take: 6,
    select: { lemma: true },
  });
  const targetWords = vocabDue.map((item) => item.lemma.toLowerCase());

  const coldStartActive = Boolean(profile?.coldStartActive ?? true);
  let qualityDiagnosticOverride: "vocab" | "grammar" | "lo" | null = null;
  if (Math.random() < 0.2) {
    try {
      const quality = await buildGseQualityReport();
      if (quality.correctivePolicy.active) {
        qualityDiagnosticOverride = quality.correctivePolicy.domain as "vocab" | "grammar" | "lo";
      }
    } catch {
      // keep runtime path resilient even if quality report fails
    }
  }
  const diagnosticMode =
    coldStartActive || Boolean(profile?.placementFresh) || projection.placementUncertainty > 0.38;
  const plannerStartedAt = Date.now();
  const decision = await planNextTaskDecision({
    studentId: student.studentId,
    stage: projection.promotionStage,
    ageBand: profile?.ageBand || "9-11",
    candidateTaskTypes:
      requestedType && requestedType.length > 0 ? [requestedType, ...ALL_TASK_TYPES] : ALL_TASK_TYPES,
    requestedType,
    diagnosticMode: diagnosticMode || Boolean(qualityDiagnosticOverride),
    preferredNodeIds: profile?.placementFresh ? placementUncertainNodes : undefined,
    qualityDomainFocus: qualityDiagnosticOverride,
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
    stage: projection.promotionStage,
    ageBand: profile?.ageBand || "9-11",
    targetWords: decision.chosenTaskType === "target_vocab" ? targetWords : [],
    targetNodeIds: decision.targetNodeIds,
    focusSkills: weakestSkills,
    plannerReason: decision.selectionReason,
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
    const fallbackWords = targetWords.slice(0, 6);
    if (fallbackWords.length >= 2) {
      prompt = `Use these words in a short talk: ${fallbackWords.join(", ")}.`;
      promptTargetWords = fallbackWords;
    }
  }

  const referenceText =
    selectedTaskType === "read_aloud" ? extractReferenceText(prompt || generated.prompt) : null;
  if (selectedTaskType === "read_aloud" && !referenceText) {
    const fallbackReadAloud = buildTaskTemplate("read_aloud", {
      stage: projection.promotionStage,
      reason: decision.selectionReason,
      focusSkills: weakestSkills,
    });
    prompt = fallbackReadAloud.prompt;
  }
  const effectiveReferenceText =
    selectedTaskType === "read_aloud" ? extractReferenceText(prompt || generated.prompt) : null;

  const taskMeta: Record<string, unknown> = {
    stage: projection.promotionStage,
    plannerReason: decision.selectionReason,
    focusSkills: weakestSkills,
    requiredWords:
      selectedTaskType === "target_vocab"
        ? (promptTargetWords.length > 0 ? promptTargetWords : targetWords)
        : undefined,
    expectedArtifacts: generated.expectedArtifacts,
    scoringHooks: generated.scoringHooks,
    verificationTargetNodeIds: decision.verificationTargetNodeIds,
    selectionReasonType: decision.selectionReasonType,
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
    stage: projection.promotionStage,
    taskType: selectedTaskType,
    ageBand: profile?.ageBand || "9-11",
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
  await emitPlannerLatencySnapshot();

  const targetNodes = await prisma.gseNode.findMany({
    where: { nodeId: { in: gseSelection.targetNodeIds } },
    select: { nodeId: true, descriptor: true },
  });
  const targetNodeLabels = gseSelection.targetNodeIds.map((nodeId) => {
    const row = targetNodes.find((item) => item.nodeId === nodeId);
    return { nodeId, label: row?.descriptor || nodeId };
  });
  const promptSimilarity = similarityToRecent(prompt, recentPrompts);

  return NextResponse.json({
    taskId: task.id,
    type: task.type,
    prompt: task.prompt,
    assessmentMode: effectiveAssessmentMode,
    maxDurationSec: effectiveMaxDurationSec,
    constraints: effectiveConstraints,
    stage: projection.promotionStage,
    placementStage: projection.placementStage,
    ageBand: profile?.ageBand || "9-11",
    reason: decision.selectionReason,
    targetSkills: weakestSkills,
    targetWords,
    recommendedTaskTypes: ALL_TASK_TYPES,
    placementFresh: Boolean(profile?.placementFresh),
    coldStartActive,
    coldStartAttempts: profile?.coldStartAttempts || 0,
    placementUncertainNodes,
    carryoverSummary: profile?.placementCarryoverJson || null,
    diagnosticMode,
    decisionId: decision.decisionId,
    primaryGoal: decision.primaryGoal,
    selectionReasonType: decision.selectionReasonType,
    verificationTargetNodeIds: decision.verificationTargetNodeIds,
    domainsTargeted: decision.domainsTargeted,
    rotationApplied: decision.rotationApplied,
    rotationReason: decision.rotationReason,
    difficulty: generated.estimatedDifficulty,
    expectedGain: decision.expectedGain,
    similarityToRecent: promptSimilarity,
    fallbackUsed: generated.fallbackUsed,
    fallbackReason: generated.fallbackReason || null,
    correctivePolicyDomain: qualityDiagnosticOverride,
    targetNodeIds: gseSelection.targetNodeIds,
    targetNodeLabels,
    selectionReason: decision.selectionReason || gseSelection.selectionReason,
  });
}

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
import { buildOodTaskSpecCandidate, buildOodTaskSpecMetadataJson } from "@/lib/ood/generator";
import { buildDisambiguationProbePlan } from "@/lib/causal/disambiguationProbe";
import { computeOodBudgetDecision } from "@/lib/ood/budgetController";
import {
  applyFastLaneToDiagnosticMode,
  evaluateFastLaneDecision,
} from "@/lib/policy/fastLane";
import {
  buildImmediateSelfRepairPrompt,
  findPendingImmediateSelfRepairCycle,
  SELF_REPAIR_IMMEDIATE_LOOP_VERSION,
} from "@/lib/selfRepair/immediateLoop";

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
  const pendingImmediateSelfRepair = await findPendingImmediateSelfRepairCycle(student.studentId);
  const latestCausalDiagnosis = await prisma.causalDiagnosis.findFirst({
    where: { studentId: student.studentId },
    orderBy: { createdAt: "desc" },
    select: {
      attemptId: true,
      modelVersion: true,
      topLabel: true,
      entropy: true,
      topMargin: true,
      distributionJson: true,
      createdAt: true,
    },
  });
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
  const fastLaneDecision = evaluateFastLaneDecision({
    projectionConfidence: projection.confidence,
    placementConfidence: projection.placementConfidence,
    placementUncertainty: projection.placementUncertainty,
    promotionReady: projection.promotionReady,
    stressGateRequired: projection.stressGate.required,
    targetStageCoverage70: projection.targetStageStats.coverage70,
    coldStartActive,
    placementFresh: Boolean(profile?.placementFresh),
  });
  let qualityDiagnosticOverride: "vocab" | "grammar" | "lo" | null = null;
  if (!fastLaneDecision.reduceDiagnosticDensity && Math.random() < 0.2) {
    try {
      const quality = await buildGseQualityReport();
      if (quality.correctivePolicy.active) {
        qualityDiagnosticOverride = quality.correctivePolicy.domain as "vocab" | "grammar" | "lo";
      }
    } catch {
      // keep runtime path resilient even if quality report fails
    }
  }
  const baseDiagnosticMode =
    coldStartActive || Boolean(profile?.placementFresh) || projection.placementUncertainty > 0.38;
  const effectiveRequestedType = pendingImmediateSelfRepair?.sourceTaskType || requestedType;
  const diagnosticMode = applyFastLaneToDiagnosticMode(
    baseDiagnosticMode || Boolean(qualityDiagnosticOverride),
    fastLaneDecision
  );
  const plannerStartedAt = Date.now();
  const domainStages = {
    vocab: projection.domainStages.vocab.stage,
    grammar: projection.domainStages.grammar.stage,
    communication: projection.domainStages.communication.stage,
  };
  const decision = await planNextTaskDecision({
    studentId: student.studentId,
    stage: projection.promotionStage,
    ageBand: profile?.ageBand || "9-11",
    candidateTaskTypes:
      effectiveRequestedType && effectiveRequestedType.length > 0
        ? [effectiveRequestedType, ...ALL_TASK_TYPES]
        : ALL_TASK_TYPES,
    requestedType: effectiveRequestedType,
    diagnosticMode,
    preferredNodeIds:
      pendingImmediateSelfRepair?.sourceTargetNodeIds && pendingImmediateSelfRepair.sourceTargetNodeIds.length > 0
        ? pendingImmediateSelfRepair.sourceTargetNodeIds
        : profile?.placementFresh
        ? placementUncertainNodes
        : undefined,
    qualityDomainFocus: qualityDiagnosticOverride,
    domainStages,
    causalSnapshot: latestCausalDiagnosis
      ? {
          attemptId: latestCausalDiagnosis.attemptId,
          modelVersion: latestCausalDiagnosis.modelVersion,
          topLabel: latestCausalDiagnosis.topLabel,
          entropy: latestCausalDiagnosis.entropy,
          topMargin: latestCausalDiagnosis.topMargin,
          distributionJson: latestCausalDiagnosis.distributionJson,
        }
      : null,
  });

  const [recentTaskInstances, historicalTaskCount, recentOodSignals] = await Promise.all([
    prisma.taskInstance.findMany({
      where: { studentId: student.studentId },
      include: { task: { select: { prompt: true, metaJson: true } } },
      orderBy: { createdAt: "desc" },
      take: 16,
    }),
    prisma.taskInstance.count({
      where: { studentId: student.studentId },
    }),
    prisma.oODTaskSpec.findMany({
      where: { studentId: student.studentId },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        verdict: true,
        status: true,
        createdAt: true,
      },
    }),
  ]);
  const oodBudgetDecision = computeOodBudgetDecision({
    taskOrdinal: historicalTaskCount + 1,
    selectionReasonType: decision.selectionReasonType,
    primaryGoal: decision.primaryGoal,
    recentSignals: recentOodSignals,
    fastLane: {
      eligible: fastLaneDecision.eligible,
      oodBudgetRateDelta: fastLaneDecision.oodBudgetRateDelta,
      protocolVersion: fastLaneDecision.protocolVersion,
    },
  });
  const recentPrompts = recentTaskInstances
    .map((item) => item.task?.prompt || "")
    .filter((value) => value.length > 0);
  const disambiguationProbePlan = buildDisambiguationProbePlan({
    shouldTrigger: pendingImmediateSelfRepair ? false : decision.ambiguityTrigger.shouldTrigger,
    topCauseLabels: decision.ambiguityTrigger.topCauseLabels,
    recentTasks: recentTaskInstances.map((row) => ({
      taskType: row.taskType,
      createdAt: row.createdAt,
      metaJson: row.task?.metaJson || null,
    })),
  });
  const selectedTaskType = pendingImmediateSelfRepair
    ? pendingImmediateSelfRepair.sourceTaskType
    : disambiguationProbePlan.enabled && disambiguationProbePlan.selectedTaskType
    ? disambiguationProbePlan.selectedTaskType
    : decision.chosenTaskType;

  // For target_vocab, words in the prompt MUST match planner target nodes — otherwise we penalize for words we never asked for.
  // Only use GSE_VOCAB descriptors as words; LO/grammar descriptors are sentences, not words.
  const targetWordsForPrompt =
    selectedTaskType === "target_vocab"
      ? (() => {
          const types = decision.targetNodeTypes ?? [];
          const fromNodes = decision.targetNodeDescriptors
            .filter((_, i) => !types[i] || types[i] === "GSE_VOCAB")
            .map((d) => {
              const w = d.trim().toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim();
              const first = w.split(/\s+/).filter((t) => t.length >= 2)[0];
              return first ?? w.slice(0, 20);
            })
            .filter((w) => w.length >= 2);
          const uniq = [...new Set(fromNodes)];
          return uniq.length >= 2 ? uniq : targetWords;
        })()
      : [];

  const generated = await generateTaskSpec({
    taskType: selectedTaskType,
    stage: projection.promotionStage,
    ageBand: profile?.ageBand || "9-11",
    targetWords: selectedTaskType === "target_vocab" ? targetWordsForPrompt : [],
    targetNodeIds: decision.targetNodeIds,
    targetNodeLabels: decision.targetNodeDescriptors,
    targetNodeTypes: decision.targetNodeTypes,
    focusSkills: weakestSkills,
    plannerReason: pendingImmediateSelfRepair
      ? `Immediate self-repair retry for attempt ${pendingImmediateSelfRepair.sourceAttemptId}`
      : decision.selectionReason,
    primaryGoal: pendingImmediateSelfRepair ? "mandatory_immediate_self_repair" : decision.primaryGoal,
    recentPrompts,
    domainStages: {
      vocab: domainStages.vocab,
      grammar: domainStages.grammar,
    },
    disambiguationProbe: disambiguationProbePlan,
  });
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
  if (pendingImmediateSelfRepair) {
    prompt = buildImmediateSelfRepairPrompt({
      sourcePrompt: pendingImmediateSelfRepair.sourcePrompt,
      causeLabel: pendingImmediateSelfRepair.causeLabel,
      feedback: pendingImmediateSelfRepair.feedback,
    });
  }
  let promptTargetWords = selectedTaskType === "target_vocab" ? extractRequiredWords(prompt) : [];
  if (selectedTaskType === "target_vocab" && promptTargetWords.length < 2) {
    const fallbackWords = targetWordsForPrompt.length >= 2 ? targetWordsForPrompt : targetWords.slice(0, 6);
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
    ambiguityTrigger: decision.ambiguityTrigger,
    causalRemediation: decision.causalRemediation,
    causalDisambiguationProbe: disambiguationProbePlan,
    causalSnapshotRef: latestCausalDiagnosis
      ? {
          attemptId: latestCausalDiagnosis.attemptId,
          modelVersion: latestCausalDiagnosis.modelVersion,
          createdAt: latestCausalDiagnosis.createdAt.toISOString(),
        }
      : null,
    hybridPolicy: decision.hybridPolicy,
    shadowPolicy: decision.shadowPolicy,
    selfRepair: pendingImmediateSelfRepair
      ? {
          mode: "immediate_retry",
          protocolVersion: SELF_REPAIR_IMMEDIATE_LOOP_VERSION,
          cycleId: pendingImmediateSelfRepair.cycleId,
          sourceAttemptId: pendingImmediateSelfRepair.sourceAttemptId,
          sourceTaskType: pendingImmediateSelfRepair.sourceTaskType,
          sourceTaskScore: pendingImmediateSelfRepair.sourceTaskScore,
          sourceTaskInstanceId: pendingImmediateSelfRepair.sourceTaskInstanceId,
          causeLabel: pendingImmediateSelfRepair.causeLabel,
        }
      : null,
    fastLane: fastLaneDecision,
    oodBudgetController: oodBudgetDecision,
  };

  const oodCandidate = buildOodTaskSpecCandidate({
    studentId: student.studentId,
    taskType: selectedTaskType,
    taskOrdinal: historicalTaskCount + 1,
    decisionLogId: decision.decisionId,
    estimatedDifficulty: generated.estimatedDifficulty ?? decision.estimatedDifficulty,
    budgetDecision: oodBudgetDecision,
  });
  if (oodCandidate) {
    taskMeta.oodAxisTags = oodCandidate.axisTags;
    taskMeta.oodGenerator = (oodCandidate.metadata as Record<string, unknown>) || null;
  }

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

  // Target nodes always from planner; LLM is not asked for IDs (only for instruction text and words).
  const gseSelection = await assignTaskTargetsFromCatalog({
    taskId: task.id,
    stage: projection.promotionStage,
    taskType: selectedTaskType,
    ageBand: profile?.ageBand || "9-11",
    studentId: student.studentId,
    preferredNodeIds: decision.targetNodeIds,
    domainStages,
  });
  if (gseSelection.targetNodeIds.length === 0) {
    return NextResponse.json(
      { error: "Planner could not resolve target GSE nodes for this task." },
      { status: 503 }
    );
  }

  const taskInstance = await createTaskInstance({
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
      fallbackReason: generated.fallbackReason ?? null,
    } as Prisma.InputJsonValue,
    fallbackUsed: generated.fallbackUsed,
    estimatedDifficulty: generated.estimatedDifficulty,
  });

  let oodTaskSpec:
    | {
        id: string;
        axisTags: string[];
        status: string;
        difficultyAnchor: number | null;
        createdAt: Date;
      }
    | null = null;
  if (oodCandidate) {
    oodTaskSpec = await prisma.oODTaskSpec.create({
      data: {
        studentId: student.studentId,
        taskInstanceId: taskInstance.id,
        decisionLogId: decision.decisionId,
        axisTags: oodCandidate.axisTags,
        difficultyAnchor: oodCandidate.difficultyAnchor ?? null,
        inDomainDifficulty: oodCandidate.inDomainDifficulty ?? null,
        difficultyDelta: oodCandidate.difficultyDelta ?? null,
        status: oodCandidate.status,
        metadataJson: buildOodTaskSpecMetadataJson(oodCandidate) as Prisma.InputJsonValue,
      },
      select: {
        id: true,
        axisTags: true,
        status: true,
        difficultyAnchor: true,
        createdAt: true,
      },
    });
  }

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
    targetWords: selectedTaskType === "target_vocab" ? promptTargetWords : targetWords,
    recommendedTaskTypes: ALL_TASK_TYPES,
    placementFresh: Boolean(profile?.placementFresh),
    coldStartActive,
    coldStartAttempts: profile?.coldStartAttempts || 0,
    placementUncertainNodes,
    carryoverSummary: profile?.placementCarryoverJson || null,
    diagnosticMode: decision.diagnosticMode,
    decisionId: decision.decisionId,
    primaryGoal: decision.primaryGoal,
    selectionReasonType: decision.selectionReasonType,
    causalRemediation: decision.causalRemediation,
    causalAmbiguityTrigger: decision.ambiguityTrigger,
    hybridPolicy: decision.hybridPolicy,
    shadowPolicy: decision.shadowPolicy,
    selfRepair: taskMeta.selfRepair ?? null,
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
    disambiguationProbe: disambiguationProbePlan,
    fastLane: fastLaneDecision,
    oodBudget: oodBudgetDecision,
    targetNodeIds: gseSelection.targetNodeIds,
    targetNodeLabels,
    selectionReason: decision.selectionReason || gseSelection.selectionReason,
    oodTaskSpec: oodTaskSpec
      ? {
          id: oodTaskSpec.id,
          axisTags: oodTaskSpec.axisTags,
          status: oodTaskSpec.status,
          difficultyAnchor: oodTaskSpec.difficultyAnchor,
          createdAt: oodTaskSpec.createdAt.toISOString(),
        }
      : null,
  });
}

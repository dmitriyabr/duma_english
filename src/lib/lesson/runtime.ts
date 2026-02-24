import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  assignTaskTargetsFromCatalog,
  createTaskInstance,
  nextTargetNodesForStudent,
} from "@/lib/gse/planner";
import { generateTaskSpec } from "@/lib/taskGenerator";
import { extractRequiredWords } from "@/lib/taskText";
import { computeCoverageDebt } from "@/lib/gse/coverageDebt";
import {
  lessonSessionStatusSchema,
  type CoverageDebtView,
  type LessonMissionHeaderView,
  type LessonSessionView,
  type LessonStepView,
  type LessonSummaryView,
  type LessonTurnResultView,
  type LessonTurnView,
  type LessonNextAction,
} from "@/lib/contracts/lessonRuntime";
import {
  buildLessonMissionSeed,
  pickPrimaryTaskType,
  requiredTurnsForTask,
} from "@/lib/lesson/mission";
import {
  buildTransferMeta,
  pickTransferTaskType,
} from "@/lib/lesson/transferStep";
import {
  buildCorrectivePrompt,
  buildPronunciationDrillPlan,
  derivePronunciationIssuesFromAttempt,
} from "@/lib/lesson/corrective";
import { resolveTurnNextAction } from "@/lib/lesson/turnEngine";
import { buildLessonSummary } from "@/lib/lesson/summary";

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asString(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function asNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function compactTurnText(value: string | null | undefined, maxChars = 180) {
  if (typeof value !== "string") return null;
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) return null;
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, maxChars - 1).trim()}...`;
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function mapAssessmentMode(taskType: string) {
  if (taskType === "read_aloud") return "pa" as const;
  if (taskType === "writing_prompt") return "text" as const;
  return "stt" as const;
}

function mapDurationCap(mode: "pa" | "stt" | "text") {
  if (mode === "pa") return 35;
  if (mode === "text") return 300;
  return 75;
}

function hasTerminalAttemptStatus(status: string) {
  return status === "completed" || status === "failed" || status === "needs_retry";
}

function attemptScore(scoresJson: unknown) {
  const scores = asObject(scoresJson);
  const taskScore = typeof scores.taskScore === "number" ? scores.taskScore : null;
  const overallScore = typeof scores.overallScore === "number" ? scores.overallScore : null;
  return taskScore ?? overallScore;
}

function buildStepTaskView(step: {
  task: {
    id: string;
    type: string;
    prompt: string;
    metaJson: unknown;
  } | null;
  taskInstance: {
    targetNodeIds: string[];
  } | null;
  source: string;
  targetNodeIds: string[];
}) {
  if (!step.task) return null;
  const meta = asObject(step.task.metaJson);
  const constraintsRaw = asObject(meta.constraints);
  const assessmentModeRaw = meta.assessmentMode;
  const assessmentMode =
    assessmentModeRaw === "pa" || assessmentModeRaw === "stt" || assessmentModeRaw === "text"
      ? assessmentModeRaw
      : mapAssessmentMode(step.task.type);
  const maxDurationSec = asNumber(meta.maxDurationSec, mapDurationCap(assessmentMode));
  return {
    taskId: step.task.id,
    taskType: step.task.type,
    prompt: step.task.prompt,
    assessmentMode,
    constraints: {
      minSeconds: Math.max(5, Math.round(asNumber(constraintsRaw.minSeconds, 8))),
      maxSeconds: Math.max(10, Math.round(asNumber(constraintsRaw.maxSeconds, maxDurationSec))),
    },
    maxDurationSec,
    targetNodeIds:
      (step.taskInstance?.targetNodeIds && step.taskInstance.targetNodeIds.length > 0
        ? step.taskInstance.targetNodeIds
        : step.targetNodeIds) || [],
    source: step.source,
  };
}

function mapTurnView(turn: {
  id: string;
  turnIndex: number;
  role: string;
  promptText: string | null;
  attemptId: string | null;
  attempt?: {
    transcript: string | null;
  } | null;
  status: string;
  evaluationJson: unknown;
  createdAt: Date;
}): LessonTurnView {
  const fallbackTranscript = turn.role === "student" ? compactTurnText(turn.attempt?.transcript) : null;
  return {
    id: turn.id,
    turnIndex: turn.turnIndex,
    role: turn.role === "coach" ? "coach" : "student",
    promptText: turn.promptText || fallbackTranscript,
    attemptId: turn.attemptId,
    status: turn.status,
    evaluation: turn.evaluationJson ? (asObject(turn.evaluationJson) as Record<string, unknown>) : null,
    createdAt: turn.createdAt.toISOString(),
  };
}

function mapStepView(step: {
  id: string;
  ordinal: number;
  stepType: string;
  status: string;
  source: string;
  targetNodeIds: string[];
  score: number | null;
  startedAt: Date | null;
  completedAt: Date | null;
  metaJson: unknown;
  turns: Array<{
    id: string;
    turnIndex: number;
    role: string;
    promptText: string | null;
    attemptId: string | null;
    attempt?: {
      transcript: string | null;
    } | null;
    status: string;
    evaluationJson: unknown;
    createdAt: Date;
  }>;
  task: {
    id: string;
    type: string;
    prompt: string;
    metaJson: unknown;
  } | null;
  taskInstance: {
    targetNodeIds: string[];
  } | null;
}): LessonStepView {
  const normalizedStatus =
    step.status === "pending" ||
    step.status === "active" ||
    step.status === "passed" ||
    step.status === "failed" ||
    step.status === "skipped"
      ? step.status
      : "pending";

  return {
    id: step.id,
    ordinal: step.ordinal,
    stepType:
      step.stepType === "dialogue" || step.stepType === "drill" || step.stepType === "transfer" || step.stepType === "review"
        ? step.stepType
        : "dialogue",
    status: normalizedStatus,
    source: step.source,
    targetNodeIds: step.targetNodeIds,
    score: step.score,
    startedAt: step.startedAt ? step.startedAt.toISOString() : null,
    completedAt: step.completedAt ? step.completedAt.toISOString() : null,
    task: buildStepTaskView(step),
    turns: step.turns.map(mapTurnView),
    meta: step.metaJson ? asObject(step.metaJson) : null,
  };
}

function extractCoverageDebtFromProgress(progressJson: unknown) {
  const progress = asObject(progressJson);
  const debt = asObject(progress.coverageDebtAfter || progress.coverageDebtBefore);
  return {
    total: asNumber(debt.total, 0),
    unseen: asNumber(debt.unseen, 0),
    underTested: asNumber(debt.underTested, 0),
    severeNodeIds: Array.isArray(debt.severeNodeIds) ? debt.severeNodeIds.map((id) => String(id)) : [],
    severeDescriptors: Array.isArray(debt.severeDescriptors)
      ? debt.severeDescriptors.map((label) => String(label))
      : [],
  } satisfies CoverageDebtView;
}

function buildMissionHeader(session: LessonSessionView): LessonMissionHeaderView {
  const mission = asObject(session.mission);
  const activeStep = session.steps.find((step) => step.status === "active") || session.steps.find((step) => step.status === "pending") || null;
  const completedSteps = session.steps.filter((step) => step.status === "passed" || step.status === "skipped").length;
  const totalSteps = Math.max(1, session.steps.length);

  const cta =
    !activeStep
      ? "Finish"
      : activeStep.stepType === "drill"
      ? "Retry line"
      : activeStep.stepType === "transfer"
      ? "Next scene"
      : "Start";

  return {
    title: asString(mission.title, "Mission"),
    goal: asString(mission.goal, "Scene one now. Scene two next."),
    stepLabel: activeStep ? `Level ${activeStep.ordinal + 1} / ${totalSteps}` : "Mission done",
    progressLabel: `${completedSteps} stars`,
    primaryCta: cta,
    coverageDebt: extractCoverageDebtFromProgress(session.progress),
  };
}

async function loadLessonSessionOrThrow(sessionId: string, studentId: string) {
  const session = await prisma.lessonSession.findFirst({
    where: { id: sessionId, studentId },
    include: {
      steps: {
        orderBy: { ordinal: "asc" },
        include: {
          turns: {
            orderBy: { turnIndex: "asc" },
            include: {
              attempt: {
                select: {
                  transcript: true,
                },
              },
            },
          },
          task: {
            select: {
              id: true,
              type: true,
              prompt: true,
              metaJson: true,
            },
          },
          taskInstance: {
            select: {
              targetNodeIds: true,
            },
          },
        },
      },
    },
  });

  if (!session) {
    throw new Error("LESSON_NOT_FOUND");
  }

  const status = lessonSessionStatusSchema.safeParse(session.status).success
    ? (session.status as "active" | "completed" | "abandoned")
    : "active";

  const mapped: LessonSessionView = {
    id: session.id,
    studentId: session.studentId,
    classId: session.classId,
    status,
    mission: asObject(session.missionJson),
    progress: asObject(session.progressJson),
    currentStepIndex: session.currentStepIndex,
    currentTurnIndex: session.currentTurnIndex,
    startedAt: session.startedAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    completedAt: session.completedAt ? session.completedAt.toISOString() : null,
    steps: session.steps.map(mapStepView),
  };

  return mapped;
}

function activeOrPendingStep(session: LessonSessionView) {
  return (
    session.steps.find((step) => step.status === "active") ||
    session.steps.find((step) => step.status === "pending") ||
    null
  );
}

async function createLessonTask(params: {
  studentId: string;
  taskType: string;
  stage: string;
  ageBand: string;
  plannerReason: string;
  primaryGoal: string;
  preferredNodeIds: string[];
  promptOverride?: string;
}) {
  const generated = await generateTaskSpec({
    taskType: params.taskType,
    stage: params.stage,
    ageBand: params.ageBand,
    targetWords: params.taskType === "target_vocab" ? params.preferredNodeIds.slice(0, 4) : [],
    targetNodeIds: params.preferredNodeIds,
    focusSkills: ["speaking", "grammar"],
    plannerReason: params.plannerReason,
    primaryGoal: params.primaryGoal,
  });

  const assessmentMode = mapAssessmentMode(params.taskType);
  const maxDurationSec = Math.min(mapDurationCap(assessmentMode), Math.max(10, generated.maxDurationSec));
  const constraints = {
    minSeconds: Math.max(5, Math.min(maxDurationSec, generated.constraints.minSeconds)),
    maxSeconds: Math.max(10, Math.min(maxDurationSec, Math.max(generated.constraints.maxSeconds, generated.constraints.minSeconds))),
  };

  let prompt = params.promptOverride || generated.prompt;
  if (params.taskType === "target_vocab") {
    const words = extractRequiredWords(prompt);
    if (words.length < 2) {
      const fallbackWords = params.preferredNodeIds.slice(0, 3);
      prompt = `Use these words in a short talk: ${fallbackWords.join(", ")}.`;
    }
  }

  const task = await prisma.task.create({
    data: {
      type: params.taskType,
      prompt,
      level: Math.max(1, Math.round((generated.estimatedDifficulty || 45) / 20)),
      metaJson: {
        assessmentMode,
        maxDurationSec,
        constraints,
        lessonRuntimeV1: true,
        plannerReason: params.plannerReason,
        primaryGoal: params.primaryGoal,
        expectedArtifacts: generated.expectedArtifacts,
        scoringHooks: generated.scoringHooks,
      } as Prisma.InputJsonValue,
    },
    select: {
      id: true,
      type: true,
      prompt: true,
      metaJson: true,
    },
  });

  const selection = await assignTaskTargetsFromCatalog({
    taskId: task.id,
    stage: params.stage,
    taskType: params.taskType,
    ageBand: params.ageBand,
    studentId: params.studentId,
    preferredNodeIds: params.preferredNodeIds,
  });

  const taskInstance = await createTaskInstance({
    studentId: params.studentId,
    taskId: task.id,
    taskType: params.taskType,
    targetNodeIds: selection.targetNodeIds,
    specJson: {
      taskType: params.taskType,
      prompt,
      constraints,
      maxDurationSec,
      assessmentMode,
      targetNodes: selection.targetNodeIds,
      fallbackUsed: generated.fallbackUsed,
      fallbackReason: generated.fallbackReason ?? null,
    } as Prisma.InputJsonValue,
    fallbackUsed: generated.fallbackUsed,
    estimatedDifficulty: generated.estimatedDifficulty,
  });

  return {
    task,
    taskInstance,
    targetNodeIds: selection.targetNodeIds,
    constraints,
    maxDurationSec,
    assessmentMode,
  };
}

function mergeProgressJson(progressJson: unknown, patch: Record<string, unknown>) {
  const progress = asObject(progressJson);
  return {
    ...progress,
    ...patch,
  };
}

export async function startLessonRuntime(params: {
  studentId: string;
  classId: string;
  forceNew?: boolean;
}) {
  const active = await prisma.lessonSession.findFirst({
    where: { studentId: params.studentId, status: "active" },
    orderBy: { startedAt: "desc" },
    select: { id: true },
  });

  if (active && !params.forceNew) {
    const lessonSession = await loadLessonSessionOrThrow(active.id, params.studentId);
    const missionHeader = buildMissionHeader(lessonSession);
    return {
      lessonSession,
      activeStep: activeOrPendingStep(lessonSession),
      missionHeader,
    };
  }

  if (active && params.forceNew) {
    await prisma.lessonSession.updateMany({
      where: { studentId: params.studentId, status: "active" },
      data: {
        status: "abandoned",
        completedAt: new Date(),
      },
    });
  }

  const profile = await prisma.learnerProfile.findUnique({
    where: { studentId: params.studentId },
    select: { stage: true, ageBand: true },
  });
  const stage = profile?.stage || "A1";
  const ageBand = profile?.ageBand || "9-11";

  const coverageDebtBefore = await computeCoverageDebt(params.studentId, stage);
  const nextTargets = await nextTargetNodesForStudent(params.studentId, 4);
  const preferredNodeIds =
    coverageDebtBefore.severeNodeIds.length > 0
      ? coverageDebtBefore.severeNodeIds.slice(0, 4)
      : nextTargets.map((row) => row.nodeId).slice(0, 4);

  const primaryTaskType = pickPrimaryTaskType(stage);
  const transferTaskType = pickTransferTaskType(primaryTaskType, stage);

  const [dialogueTask, transferTask] = await Promise.all([
    createLessonTask({
      studentId: params.studentId,
      taskType: primaryTaskType,
      stage,
      ageBand,
      plannerReason: "Lesson mission primary step",
      primaryGoal: "lesson_mission_dialogue",
      preferredNodeIds,
    }),
    createLessonTask({
      studentId: params.studentId,
      taskType: transferTaskType,
      stage,
      ageBand,
      plannerReason: "In-session transfer check",
      primaryGoal: "lesson_transfer_check",
      preferredNodeIds,
    }),
  ]);

  const missionSeed = buildLessonMissionSeed({
    stage,
    coverageDebt: coverageDebtBefore,
    primaryTaskType,
    primaryPrompt: dialogueTask.task.prompt,
    transferPrompt: transferTask.task.prompt,
  });

  const session = await prisma.lessonSession.create({
    data: {
      studentId: params.studentId,
      classId: params.classId,
      status: "active",
      missionJson: {
        ...missionSeed,
      } as Prisma.InputJsonValue,
      progressJson: {
        coverageDebtBefore,
        coverageDebtAfter: coverageDebtBefore,
        correctiveTriggered: 0,
        correctiveResolved: 0,
        transferPassed: false,
      } as Prisma.InputJsonValue,
      currentStepIndex: 0,
      currentTurnIndex: 0,
    },
    select: { id: true },
  });

  await prisma.lessonStep.createMany({
    data: [
      {
        lessonSessionId: session.id,
        ordinal: 0,
        stepType: "dialogue",
        taskId: dialogueTask.task.id,
        taskInstanceId: dialogueTask.taskInstance.id,
        status: "active",
        source: "mission",
        targetNodeIds: dialogueTask.targetNodeIds,
        metaJson: {
          requiredTurns: missionSeed.requiredTurns,
          mode: "voice_first",
        } as Prisma.InputJsonValue,
        startedAt: new Date(),
      },
      {
        lessonSessionId: session.id,
        ordinal: 1,
        stepType: "transfer",
        taskId: transferTask.task.id,
        taskInstanceId: transferTask.taskInstance.id,
        status: "pending",
        source: "transfer",
        targetNodeIds: transferTask.targetNodeIds,
        metaJson: buildTransferMeta({
          fromTaskType: primaryTaskType,
          toTaskType: transferTaskType,
          reason: "New scene with the same skill.",
        }) as Prisma.InputJsonValue,
      },
      {
        lessonSessionId: session.id,
        ordinal: 2,
        stepType: "review",
        status: "pending",
        source: "mission",
        targetNodeIds: preferredNodeIds,
        metaJson: {
          autoSummaryStep: true,
          cardTitle: "Mission recap",
        } as Prisma.InputJsonValue,
      },
    ],
  });

  const lessonSession = await loadLessonSessionOrThrow(session.id, params.studentId);
  const missionHeader = buildMissionHeader(lessonSession);
  return {
    lessonSession,
    activeStep: activeOrPendingStep(lessonSession),
    missionHeader,
  };
}

export async function getActiveLessonRuntime(studentId: string) {
  const active = await prisma.lessonSession.findFirst({
    where: { studentId, status: "active" },
    orderBy: { startedAt: "desc" },
    select: { id: true },
  });
  if (!active) return { lessonSession: null, activeStep: null, missionHeader: null };

  const lessonSession = await loadLessonSessionOrThrow(active.id, studentId);
  return {
    lessonSession,
    activeStep: activeOrPendingStep(lessonSession),
    missionHeader: buildMissionHeader(lessonSession),
  };
}

export async function getLessonRuntimeState(params: {
  sessionId: string;
  studentId: string;
}) {
  const lessonSession = await loadLessonSessionOrThrow(params.sessionId, params.studentId);
  const activeStep = activeOrPendingStep(lessonSession);
  const progress = asObject(lessonSession.progress);
  const runtimeState = {
    missionProgress: {
      completedSteps: lessonSession.steps.filter((step) => step.status === "passed" || step.status === "skipped").length,
      totalSteps: lessonSession.steps.length,
    },
    currentStep: activeStep,
    dialogueTurns: activeStep?.turns || [],
    correctivePending: lessonSession.steps.some((step) => step.source === "corrective" && step.status === "active"),
    transferRequired: true,
    transferPassed: Boolean(progress.transferPassed),
  };

  return {
    lessonSession,
    activeStep,
    missionHeader: buildMissionHeader(lessonSession),
    runtimeState,
  };
}

export async function submitLessonTurn(params: {
  sessionId: string;
  studentId: string;
  mode: "voice" | "text";
  payloadRef: string;
  durationSec?: number;
}) {
  const session = await loadLessonSessionOrThrow(params.sessionId, params.studentId);
  if (session.status !== "active") {
    throw new Error("LESSON_NOT_ACTIVE");
  }

  const step = activeOrPendingStep(session);
  if (!step) {
    throw new Error("LESSON_STEP_NOT_FOUND");
  }
  if (!step.task) {
    throw new Error("LESSON_STEP_HAS_NO_TASK");
  }

  const attempt = await prisma.attempt.findFirst({
    where: {
      id: params.payloadRef,
      studentId: params.studentId,
      taskId: step.task.taskId,
    },
    select: {
      id: true,
      status: true,
      transcript: true,
      scoresJson: true,
      feedbackJson: true,
      speechMetricsJson: true,
      pronunciationIssuesJson: true,
    },
  });

  if (!attempt) {
    throw new Error("ATTEMPT_NOT_FOUND");
  }
  if (!hasTerminalAttemptStatus(attempt.status)) {
    throw new Error("ATTEMPT_NOT_READY");
  }

  const score = attemptScore(attempt.scoresJson);
  const issues = derivePronunciationIssuesFromAttempt(attempt);
  const pronunciationDrillPlan = buildPronunciationDrillPlan({
    sourcePrompt: step.task.prompt,
    issues,
  });

  if (!attempt.pronunciationIssuesJson || !Array.isArray(attempt.pronunciationIssuesJson)) {
    await prisma.attempt.update({
      where: { id: attempt.id },
      data: {
        pronunciationIssuesJson: toJsonValue(issues),
      },
    });
  }

  const existingStudentTurns = step.turns.filter((turn) => turn.role === "student").length;
  const requiredTurns = asNumber(asObject(step.meta).requiredTurns, requiredTurnsForTask(step.task.taskType));
  const hasPendingTransfer = session.steps.some(
    (candidate) =>
      candidate.stepType === "transfer" &&
      (candidate.status === "pending" || candidate.status === "active") &&
      candidate.id !== step.id,
  );

  const engine = resolveTurnNextAction({
    stepType: step.stepType,
    taskType: step.task.taskType,
    attemptStatus: attempt.status,
    score,
    requiredTurns,
    existingStudentTurns,
    hasPendingTransferStep: hasPendingTransfer,
  });

  const newTurnIndex = step.turns.length;
  const coachPrompt =
    engine.nextAction === "fix_now"
      ? "Try again now."
      : engine.nextAction === "next_turn"
      ? "Continue."
      : engine.nextAction === "transfer_step"
      ? "New scene."
      : "Scene done.";

  await prisma.$transaction(async (tx) => {
    await tx.lessonTurn.create({
      data: {
        lessonStepId: step.id,
        turnIndex: newTurnIndex,
        role: "student",
        attemptId: attempt.id,
        promptText: compactTurnText(attempt.transcript),
        status: attempt.status,
        evaluationJson: {
          mode: params.mode,
          durationSec: params.durationSec ?? null,
          score,
          pass: engine.pass,
          nextAction: engine.nextAction,
        } as Prisma.InputJsonValue,
      },
    });

    await tx.lessonTurn.create({
      data: {
        lessonStepId: step.id,
        turnIndex: newTurnIndex + 1,
        role: "coach",
        status: "generated",
        promptText: coachPrompt,
        evaluationJson: {
          reason: engine.reason,
        } as Prisma.InputJsonValue,
      },
    });

    if (engine.nextAction === "step_done" || engine.nextAction === "transfer_step") {
      await tx.lessonStep.update({
        where: { id: step.id },
        data: {
          status: "passed",
          score: score ?? undefined,
          completedAt: new Date(),
        },
      });

      if (step.stepType === "transfer") {
        const mergedProgress = mergeProgressJson(session.progress, {
          transferPassed: true,
        });
        await tx.lessonSession.update({
          where: { id: session.id },
          data: {
            progressJson: toJsonValue(mergedProgress),
          },
        });
      }
    }

    await tx.lessonSession.update({
      where: { id: session.id },
      data: {
        currentTurnIndex: session.currentTurnIndex + 1,
      },
    });
  });

  const updated = await loadLessonSessionOrThrow(params.sessionId, params.studentId);

  const turnResult: LessonTurnResultView = {
    turnId: updated.steps
      .find((candidate) => candidate.id === step.id)
      ?.turns.slice(-2)[0]?.id || "",
    attemptId: attempt.id,
    score,
    pass: engine.pass,
    pronunciationDrillPlan: engine.nextAction === "fix_now" ? pronunciationDrillPlan : null,
  };

  return {
    turnResult,
    nextAction: engine.nextAction as LessonNextAction,
    lessonSession: updated,
    activeStep: activeOrPendingStep(updated),
    missionHeader: buildMissionHeader(updated),
  };
}

async function shiftStepOrdinalsForInsert(
  tx: Prisma.TransactionClient,
  sessionId: string,
  afterOrdinal: number,
) {
  const tail = await tx.lessonStep.findMany({
    where: {
      lessonSessionId: sessionId,
      ordinal: { gt: afterOrdinal },
    },
    orderBy: { ordinal: "desc" },
    select: { id: true, ordinal: true },
  });

  for (const row of tail) {
    await tx.lessonStep.update({
      where: { id: row.id },
      data: { ordinal: row.ordinal + 1 },
    });
  }
}

export async function triggerFixNow(params: {
  sessionId: string;
  studentId: string;
  sourceTurnId: string;
}) {
  const session = await loadLessonSessionOrThrow(params.sessionId, params.studentId);
  const step = activeOrPendingStep(session);
  if (!step || !step.task) {
    throw new Error("LESSON_STEP_NOT_FOUND");
  }

  const sourceTurn = step.turns.find((turn) => turn.id === params.sourceTurnId);
  if (!sourceTurn || !sourceTurn.attemptId) {
    throw new Error("LESSON_SOURCE_TURN_NOT_FOUND");
  }

  const attempt = await prisma.attempt.findFirst({
    where: { id: sourceTurn.attemptId, studentId: params.studentId },
    select: {
      id: true,
      status: true,
      feedbackJson: true,
      speechMetricsJson: true,
      pronunciationIssuesJson: true,
    },
  });
  if (!attempt) {
    throw new Error("ATTEMPT_NOT_FOUND");
  }

  const issues = derivePronunciationIssuesFromAttempt(attempt);
  const drillPlan = buildPronunciationDrillPlan({
    sourcePrompt: step.task.prompt,
    issues,
  });
  const correctivePrompt = buildCorrectivePrompt({
    sourcePrompt: step.task.prompt,
    causeLabel: null,
    feedback: attempt.feedbackJson,
    drillPlan,
  });

  const profile = await prisma.learnerProfile.findUnique({
    where: { studentId: params.studentId },
    select: { stage: true, ageBand: true },
  });

  const correctiveTask = await createLessonTask({
    studentId: params.studentId,
    taskType: "read_aloud",
    stage: profile?.stage || "A1",
    ageBand: profile?.ageBand || "9-11",
    plannerReason: "Fix now corrective loop",
    primaryGoal: "lesson_fix_now",
    preferredNodeIds: step.targetNodeIds,
    promptOverride: correctivePrompt,
  });

  await prisma.$transaction(async (tx) => {
    await shiftStepOrdinalsForInsert(tx, session.id, step.ordinal);

    await tx.lessonStep.update({
      where: { id: step.id },
      data: {
        status: "failed",
        completedAt: new Date(),
      },
    });

    const correctiveStep = await tx.lessonStep.create({
      data: {
        lessonSessionId: session.id,
        ordinal: step.ordinal + 1,
        stepType: "drill",
        taskId: correctiveTask.task.id,
        taskInstanceId: correctiveTask.taskInstance.id,
        status: "active",
        source: "corrective",
        targetNodeIds: correctiveTask.targetNodeIds,
        metaJson: {
          sourceTurnId: params.sourceTurnId,
          issues,
          drillPlan,
          requiredTurns: 2,
        } as Prisma.InputJsonValue,
        startedAt: new Date(),
      },
      select: { id: true },
    });

    await tx.lessonTurn.create({
      data: {
        lessonStepId: correctiveStep.id,
        turnIndex: 0,
        role: "coach",
        promptText: correctivePrompt,
        status: "generated",
        evaluationJson: toJsonValue({ drillPlan }),
      },
    });

    const progress = mergeProgressJson(session.progress, {
      correctiveTriggered: asNumber(asObject(session.progress).correctiveTriggered, 0) + 1,
    });

    await tx.lessonSession.update({
      where: { id: session.id },
      data: {
        currentStepIndex: step.ordinal + 1,
        progressJson: toJsonValue(progress),
      },
    });
  });

  const updated = await loadLessonSessionOrThrow(params.sessionId, params.studentId);
  const activeStep = activeOrPendingStep(updated);

  return {
    correctiveStep: activeStep,
    drillPlan,
    lessonSession: updated,
    missionHeader: buildMissionHeader(updated),
  };
}

export async function advanceLessonRuntime(params: {
  sessionId: string;
  studentId: string;
  action: "next_turn" | "next_step";
}) {
  const session = await loadLessonSessionOrThrow(params.sessionId, params.studentId);
  if (session.status !== "active") {
    return {
      lessonSession: session,
      activeStep: activeOrPendingStep(session),
      missionHeader: buildMissionHeader(session),
    };
  }

  if (params.action === "next_turn") {
    return {
      lessonSession: session,
      activeStep: activeOrPendingStep(session),
      missionHeader: buildMissionHeader(session),
    };
  }

  const current = activeOrPendingStep(session);
  if (!current) {
    return {
      lessonSession: session,
      activeStep: null,
      missionHeader: buildMissionHeader(session),
    };
  }

  await prisma.$transaction(async (tx) => {
    if (current.status === "active") {
      await tx.lessonStep.update({
        where: { id: current.id },
        data: {
          status: "passed",
          completedAt: new Date(),
        },
      });
    }

    const next = await tx.lessonStep.findFirst({
      where: {
        lessonSessionId: session.id,
        ordinal: { gt: current.ordinal },
        status: "pending",
      },
      orderBy: { ordinal: "asc" },
      select: { id: true, ordinal: true, stepType: true },
    });

    if (next) {
      if (next.stepType === "review") {
        await tx.lessonStep.update({
          where: { id: next.id },
          data: {
            status: "passed",
            startedAt: new Date(),
            completedAt: new Date(),
          },
        });

        await tx.lessonSession.update({
          where: { id: session.id },
          data: {
            status: "completed",
            completedAt: new Date(),
            currentStepIndex: next.ordinal,
          },
        });
      } else {
        await tx.lessonStep.update({
          where: { id: next.id },
          data: {
            status: "active",
            startedAt: new Date(),
          },
        });

        await tx.lessonSession.update({
          where: { id: session.id },
          data: {
            currentStepIndex: next.ordinal,
          },
        });
      }
      return;
    }

    await tx.lessonSession.update({
      where: { id: session.id },
      data: {
        status: "completed",
        completedAt: new Date(),
      },
    });
  });

  const updated = await loadLessonSessionOrThrow(params.sessionId, params.studentId);
  return {
    lessonSession: updated,
    activeStep: activeOrPendingStep(updated),
    missionHeader: buildMissionHeader(updated),
  };
}

export async function finishLessonRuntime(params: {
  sessionId: string;
  studentId: string;
}) {
  const session = await loadLessonSessionOrThrow(params.sessionId, params.studentId);

  if (session.status === "active") {
    await prisma.$transaction(async (tx) => {
      await tx.lessonStep.updateMany({
        where: {
          lessonSessionId: session.id,
          status: { in: ["pending", "active"] },
        },
        data: {
          status: "skipped",
          completedAt: new Date(),
        },
      });

      await tx.lessonSession.update({
        where: { id: session.id },
        data: {
          status: "completed",
          completedAt: new Date(),
        },
      });
    });
  }

  const updated = await loadLessonSessionOrThrow(params.sessionId, params.studentId);
  const progress = asObject(updated.progress);
  const stage = asString(asObject(updated.mission).stage, "A1");
  const debtBefore = (asObject(progress.coverageDebtBefore) || {
    total: 0,
    unseen: 0,
    underTested: 0,
    severeNodeIds: [],
    severeDescriptors: [],
  }) as CoverageDebtView;
  const debtAfter = await computeCoverageDebt(params.studentId, stage);

  const mergedProgress = mergeProgressJson(updated.progress, {
    coverageDebtAfter: debtAfter,
  });

  await prisma.lessonSession.update({
    where: { id: updated.id },
    data: {
      progressJson: toJsonValue(mergedProgress),
    },
  });

  const refreshed = await loadLessonSessionOrThrow(params.sessionId, params.studentId);
  const summary = buildLessonSummary({
    session: refreshed,
    debtBefore,
    debtAfter,
  });

  return {
    lessonSummary: summary,
  };
}

export async function getLessonSummaryRuntime(params: {
  sessionId: string;
  studentId: string;
}) {
  const session = await loadLessonSessionOrThrow(params.sessionId, params.studentId);
  const progress = asObject(session.progress);
  const stage = asString(asObject(session.mission).stage, "A1");
  const debtBefore = {
    total: asNumber(asObject(progress.coverageDebtBefore).total, 0),
    unseen: asNumber(asObject(progress.coverageDebtBefore).unseen, 0),
    underTested: asNumber(asObject(progress.coverageDebtBefore).underTested, 0),
    severeNodeIds: Array.isArray(asObject(progress.coverageDebtBefore).severeNodeIds)
      ? (asObject(progress.coverageDebtBefore).severeNodeIds as unknown[]).map((id) => String(id))
      : [],
    severeDescriptors: Array.isArray(asObject(progress.coverageDebtBefore).severeDescriptors)
      ? (asObject(progress.coverageDebtBefore).severeDescriptors as unknown[]).map((label) => String(label))
      : [],
  } satisfies CoverageDebtView;

  const debtAfter = {
    total: asNumber(asObject(progress.coverageDebtAfter).total, debtBefore.total),
    unseen: asNumber(asObject(progress.coverageDebtAfter).unseen, debtBefore.unseen),
    underTested: asNumber(asObject(progress.coverageDebtAfter).underTested, debtBefore.underTested),
    severeNodeIds: Array.isArray(asObject(progress.coverageDebtAfter).severeNodeIds)
      ? (asObject(progress.coverageDebtAfter).severeNodeIds as unknown[]).map((id) => String(id))
      : debtBefore.severeNodeIds,
    severeDescriptors: Array.isArray(asObject(progress.coverageDebtAfter).severeDescriptors)
      ? (asObject(progress.coverageDebtAfter).severeDescriptors as unknown[]).map((label) => String(label))
      : debtBefore.severeDescriptors,
  } satisfies CoverageDebtView;

  const summary = buildLessonSummary({
    session,
    debtBefore,
    debtAfter: debtAfter.total > 0 || debtAfter.severeNodeIds.length > 0 ? debtAfter : await computeCoverageDebt(params.studentId, stage),
  });

  return {
    lessonSummary: summary as LessonSummaryView,
  };
}

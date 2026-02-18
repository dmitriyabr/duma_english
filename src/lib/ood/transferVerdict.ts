import { Prisma } from "@prisma/client";
import { ATTEMPT_STATUS } from "@/lib/attemptStatus";
import { prisma } from "@/lib/db";

export const TRANSFER_VERDICT_PROTOCOL_VERSION = "transfer-difficulty-match-v1" as const;
export const TRANSFER_PASS_SCORE_THRESHOLD = 70;
export const MATCHED_CONTROL_SCORE_THRESHOLD = 70;
export const MATCHED_CONTROL_DIFFICULTY_TOLERANCE = 8;
export const MATCHED_CONTROL_WINDOW_HOURS = 72;

export type TransferVerdict =
  | "transfer_pass"
  | "transfer_fail_validated"
  | "inconclusive_control_missing"
  | "inconclusive_missing_ood_score";

export type InDomainControlAttempt = {
  attemptId: string;
  taskScore: number;
  estimatedDifficulty: number;
  completedAt: Date;
};

export type TransferVerdictEvaluation = {
  verdict: TransferVerdict;
  oodOutcome: "pass" | "candidate_fail" | "unknown";
  oodTaskScore: number | null;
  passThreshold: number;
  matchedControlPass: boolean;
  controlCandidateCount: number;
  matchedControlCount: number;
  matchedControlPassCount: number;
  bestMatchedControl: InDomainControlAttempt | null;
  difficultyDelta: number | null;
  metadata: {
    protocolVersion: typeof TRANSFER_VERDICT_PROTOCOL_VERSION;
    evaluatedAt: string;
    oodTaskScore: number | null;
    oodOutcome: "pass" | "candidate_fail" | "unknown";
    passThreshold: number;
    inDomainDifficulty: number | null;
    controlWindowHours: number;
    matchedControlDifficultyTolerance: number;
    matchedControlScoreThreshold: number;
    controlCandidateCount: number;
    matchedControlCount: number;
    matchedControlPassCount: number;
    matchedControlPass: boolean;
    bestMatchedControlAttemptId: string | null;
    bestMatchedControlScore: number | null;
    bestMatchedControlDifficulty: number | null;
    bestMatchedControlCompletedAt: string | null;
    verdict: TransferVerdict;
    difficultyDelta: number | null;
  };
};

function round(value: number) {
  return Number(value.toFixed(4));
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function parseTaskScoreFromTaskEvaluation(taskEvaluationJson: unknown) {
  const parsed = asJsonObject(taskEvaluationJson);
  return toFiniteNumber(parsed.taskScore);
}

function pickBestMatchedControl(params: {
  inDomainDifficulty: number;
  controls: InDomainControlAttempt[];
}) {
  const ranked = [...params.controls].sort((a, b) => {
    const diffA = Math.abs(a.estimatedDifficulty - params.inDomainDifficulty);
    const diffB = Math.abs(b.estimatedDifficulty - params.inDomainDifficulty);
    if (diffA !== diffB) return diffA - diffB;
    return b.completedAt.getTime() - a.completedAt.getTime();
  });
  return ranked[0] || null;
}

export function evaluateTransferVerdict(params: {
  oodTaskScore: number | null;
  inDomainDifficulty: number | null;
  controlAttempts: InDomainControlAttempt[];
  now?: Date;
  passThreshold?: number;
  controlScoreThreshold?: number;
  difficultyTolerance?: number;
  controlWindowHours?: number;
}): TransferVerdictEvaluation {
  const now = params.now || new Date();
  const passThreshold = params.passThreshold ?? TRANSFER_PASS_SCORE_THRESHOLD;
  const controlScoreThreshold = params.controlScoreThreshold ?? MATCHED_CONTROL_SCORE_THRESHOLD;
  const difficultyTolerance = params.difficultyTolerance ?? MATCHED_CONTROL_DIFFICULTY_TOLERANCE;
  const controlWindowHours = params.controlWindowHours ?? MATCHED_CONTROL_WINDOW_HOURS;

  const controlCandidateCount = params.controlAttempts.length;
  const matchedControls =
    typeof params.inDomainDifficulty === "number"
      ? params.controlAttempts.filter(
          (row) => Math.abs(row.estimatedDifficulty - params.inDomainDifficulty!) <= difficultyTolerance
        )
      : [];
  const matchedControlCount = matchedControls.length;
  const matchedControlPasses = matchedControls.filter((row) => row.taskScore >= controlScoreThreshold);
  const matchedControlPassCount = matchedControlPasses.length;
  const matchedControlPass = matchedControlPassCount > 0;
  const bestMatchedControl =
    typeof params.inDomainDifficulty === "number"
      ? pickBestMatchedControl({
          inDomainDifficulty: params.inDomainDifficulty,
          controls: matchedControlPasses,
        })
      : null;
  const difficultyDelta =
    bestMatchedControl && typeof params.inDomainDifficulty === "number"
      ? round(params.inDomainDifficulty - bestMatchedControl.estimatedDifficulty)
      : null;

  let verdict: TransferVerdict;
  let oodOutcome: "pass" | "candidate_fail" | "unknown";

  if (typeof params.oodTaskScore !== "number") {
    verdict = "inconclusive_missing_ood_score";
    oodOutcome = "unknown";
  } else if (params.oodTaskScore >= passThreshold) {
    verdict = "transfer_pass";
    oodOutcome = "pass";
  } else if (matchedControlPass) {
    verdict = "transfer_fail_validated";
    oodOutcome = "candidate_fail";
  } else {
    verdict = "inconclusive_control_missing";
    oodOutcome = "candidate_fail";
  }

  return {
    verdict,
    oodOutcome,
    oodTaskScore: params.oodTaskScore,
    passThreshold,
    matchedControlPass,
    controlCandidateCount,
    matchedControlCount,
    matchedControlPassCount,
    bestMatchedControl,
    difficultyDelta,
    metadata: {
      protocolVersion: TRANSFER_VERDICT_PROTOCOL_VERSION,
      evaluatedAt: now.toISOString(),
      oodTaskScore: params.oodTaskScore,
      oodOutcome,
      passThreshold,
      inDomainDifficulty: params.inDomainDifficulty,
      controlWindowHours,
      matchedControlDifficultyTolerance: difficultyTolerance,
      matchedControlScoreThreshold: controlScoreThreshold,
      controlCandidateCount,
      matchedControlCount,
      matchedControlPassCount,
      matchedControlPass,
      bestMatchedControlAttemptId: bestMatchedControl?.attemptId || null,
      bestMatchedControlScore: bestMatchedControl?.taskScore || null,
      bestMatchedControlDifficulty: bestMatchedControl?.estimatedDifficulty || null,
      bestMatchedControlCompletedAt: bestMatchedControl?.completedAt.toISOString() || null,
      verdict,
      difficultyDelta,
    },
  };
}

export async function evaluateAndPersistOodTransferVerdict(params: {
  attemptId: string;
  studentId: string;
  taskId: string;
  oodTaskScore: number | null;
  now?: Date;
}) {
  const now = params.now || new Date();
  const taskInstance = await prisma.taskInstance.findUnique({
    where: { taskId: params.taskId },
    select: {
      id: true,
      estimatedDifficulty: true,
      oodTaskSpec: {
        select: {
          id: true,
          inDomainDifficulty: true,
          difficultyAnchor: true,
          metadataJson: true,
        },
      },
    },
  });

  if (!taskInstance?.oodTaskSpec) {
    return null;
  }

  const inDomainDifficulty =
    taskInstance.oodTaskSpec.inDomainDifficulty ??
    taskInstance.estimatedDifficulty ??
    taskInstance.oodTaskSpec.difficultyAnchor ??
    null;

  const windowStart = new Date(now.getTime() - MATCHED_CONTROL_WINDOW_HOURS * 60 * 60 * 1000);
  const controlsRaw = await prisma.attempt.findMany({
    where: {
      studentId: params.studentId,
      status: ATTEMPT_STATUS.COMPLETED,
      id: { not: params.attemptId },
      completedAt: {
        gte: windowStart,
        lte: now,
      },
      task: {
        taskInstance: {
          is: {
            estimatedDifficulty: { not: null },
            oodTaskSpec: { is: null },
          },
        },
      },
    },
    select: {
      id: true,
      completedAt: true,
      taskEvaluationJson: true,
      task: {
        select: {
          taskInstance: {
            select: {
              estimatedDifficulty: true,
            },
          },
        },
      },
    },
    orderBy: { completedAt: "desc" },
    take: 300,
  });

  const controls: InDomainControlAttempt[] = controlsRaw
    .map((row) => {
      if (!row.completedAt) return null;
      const taskScore = parseTaskScoreFromTaskEvaluation(row.taskEvaluationJson);
      const estimatedDifficulty = row.task.taskInstance?.estimatedDifficulty;
      if (taskScore === null || typeof estimatedDifficulty !== "number") return null;
      return {
        attemptId: row.id,
        taskScore,
        estimatedDifficulty,
        completedAt: row.completedAt,
      };
    })
    .filter((row): row is InDomainControlAttempt => row !== null);

  const evaluation = evaluateTransferVerdict({
    oodTaskScore: params.oodTaskScore,
    inDomainDifficulty,
    controlAttempts: controls,
    now,
  });

  const metadata = asJsonObject(taskInstance.oodTaskSpec.metadataJson);
  const nextMetadata = {
    ...metadata,
    transferVerdict: evaluation.metadata,
  };

  await prisma.oODTaskSpec.update({
    where: { id: taskInstance.oodTaskSpec.id },
    data: {
      status: "evaluated",
      verdict: evaluation.verdict,
      difficultyDelta: evaluation.difficultyDelta,
      metadataJson: nextMetadata as Prisma.InputJsonValue,
    },
  });

  return {
    oodTaskSpecId: taskInstance.oodTaskSpec.id,
    ...evaluation,
  };
}

import type { LessonNextAction } from "@/lib/contracts/lessonRuntime";

export type TurnEngineInput = {
  stepType: "dialogue" | "drill" | "transfer" | "review";
  taskType: string;
  attemptStatus: string;
  score: number | null;
  requiredTurns: number;
  existingStudentTurns: number;
  hasPendingTransferStep: boolean;
};

export type TurnEngineResult = {
  pass: boolean;
  nextAction: LessonNextAction;
  reason: string;
};

function isHardFail(status: string) {
  return status === "failed" || status === "needs_retry";
}

export function resolveTurnNextAction(input: TurnEngineInput): TurnEngineResult {
  if (isHardFail(input.attemptStatus)) {
    return {
      pass: false,
      nextAction: "fix_now",
      reason: "attempt_failed",
    };
  }

  const score = typeof input.score === "number" ? input.score : null;
  if (score === null || score < 60) {
    return {
      pass: false,
      nextAction: "fix_now",
      reason: "score_below_fix_threshold",
    };
  }

  const pass = score >= 70;
  const totalTurns = input.existingStudentTurns + 1;
  const minTurnsReached = totalTurns >= Math.max(1, input.requiredTurns);

  if (!minTurnsReached) {
    return {
      pass,
      nextAction: "next_turn",
      reason: "turn_quota_not_reached",
    };
  }

  if (input.stepType === "dialogue" && input.hasPendingTransferStep) {
    return {
      pass,
      nextAction: "transfer_step",
      reason: "dialogue_done_transfer_required",
    };
  }

  return {
    pass,
    nextAction: "step_done",
    reason: "step_completed",
  };
}

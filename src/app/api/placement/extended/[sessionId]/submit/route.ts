import { NextResponse } from "next/server";
import { getStudentFromRequest } from "@/lib/auth";
import { submitPlacementExtendedAnswer } from "@/lib/placement/extended";
import { isPlacementSessionActive } from "@/lib/placement/shared";
import type { PlacementSessionStatus } from "@/lib/placement/types";
import { prisma } from "@/lib/db";
import { ATTEMPT_STATUS, isAttemptRetryStatus } from "@/lib/attemptStatus";

type PlacementExtendedSubmitContext = {
  params: Promise<{ sessionId: string }>;
};

export async function POST(
  request: Request,
  context: PlacementExtendedSubmitContext
) {
  const student = await getStudentFromRequest();
  if (!student) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sessionId } = await context.params;
  const session = await prisma.placementSession.findUnique({ where: { id: sessionId } });
  if (
    !session ||
    session.studentId !== student.studentId ||
    session.placementMode !== "placement_extended"
  ) {
    return NextResponse.json({ error: "Placement session not found" }, { status: 404 });
  }
  if (!isPlacementSessionActive(session.status as PlacementSessionStatus)) {
    return NextResponse.json({ error: "Placement session is not active" }, { status: 409 });
  }

  const body = await request.json();
  const { attemptId, userFeedback } = body;

  if (typeof attemptId !== "string" || attemptId.trim().length === 0) {
    return NextResponse.json(
      { error: "Missing required field: attemptId" },
      { status: 400 }
    );
  }

  const attempt = await prisma.attempt.findUnique({
    where: { id: attemptId },
    select: {
      id: true,
      studentId: true,
      status: true,
      errorMessage: true,
      task: {
        select: {
          metaJson: true,
        },
      },
    },
  });
  if (!attempt || attempt.studentId !== student.studentId) {
    return NextResponse.json(
      { code: "ATTEMPT_NOT_FOUND", error: "Attempt not found" },
      { status: 404 }
    );
  }

  const meta = (attempt.task?.metaJson || {}) as Record<string, unknown>;
  const attemptSessionId =
    typeof meta.placementSessionId === "string" ? meta.placementSessionId : null;
  const attemptPlacementMode =
    typeof meta.placementMode === "string" ? meta.placementMode : null;
  if (attemptSessionId !== sessionId || attemptPlacementMode !== "placement_extended") {
    return NextResponse.json(
      { code: "ATTEMPT_SESSION_MISMATCH", error: "Attempt does not belong to this placement session" },
      { status: 409 }
    );
  }

  if (isAttemptRetryStatus(attempt.status)) {
    return NextResponse.json(
      {
        code: "RETRY_REQUIRED",
        error: attempt.errorMessage || "I'm sorry, I didn't hear you well. Can you try again?",
      },
      { status: 409 }
    );
  }

  if (attempt.status !== ATTEMPT_STATUS.COMPLETED) {
    return NextResponse.json(
      { code: "ATTEMPT_NOT_COMPLETED", error: "Attempt is not completed yet" },
      { status: 409 }
    );
  }

  const validFeedback = ["too_easy", "just_right", "too_hard"];
  const feedback = validFeedback.includes(userFeedback) ? userFeedback : undefined;

  let result: Awaited<ReturnType<typeof submitPlacementExtendedAnswer>>;
  try {
    result = await submitPlacementExtendedAnswer(sessionId, attemptId, feedback);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ATTEMPT_NOT_FOUND") {
      return NextResponse.json(
        { code, error: error instanceof Error ? error.message : "Attempt not found" },
        { status: 404 }
      );
    }
    if (code === "RETRY_REQUIRED" || code === "ATTEMPT_NOT_COMPLETED" || code === "ATTEMPT_SESSION_MISMATCH") {
      return NextResponse.json(
        { code, error: error instanceof Error ? error.message : "Attempt is not valid for submit" },
        { status: 409 }
      );
    }
    throw error;
  }

  if (result.finished) {
    return NextResponse.json({
      finished: true,
      reason: result.reason,
      result: result.result,
    });
  }

  if (!result.nextTask) {
    return NextResponse.json(
      { error: "Failed to generate next task" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    finished: false,
    nextTask: {
      taskId: result.nextTask.id,
      type: result.nextTask.type,
      prompt: result.nextTask.prompt,
      metaJson: result.nextTask.metaJson,
    },
  });
}

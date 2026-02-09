import { NextResponse } from "next/server";
import { getStudentFromRequest } from "@/lib/auth";
import { submitPlacementExtendedAnswer } from "@/lib/placement";

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
  const body = await request.json();
  const { attemptId, userFeedback } = body;

  if (!attemptId) {
    return NextResponse.json(
      { error: "Missing required field: attemptId" },
      { status: 400 }
    );
  }

  const validFeedback = ["too_easy", "just_right", "too_hard"];
  const feedback = validFeedback.includes(userFeedback) ? userFeedback : undefined;

  const result = await submitPlacementExtendedAnswer(
    sessionId,
    attemptId,
    feedback
  );

  if (result.finished) {
    return NextResponse.json({
      finished: true,
      reason: result.reason,
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

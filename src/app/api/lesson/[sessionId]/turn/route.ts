import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getStudentFromRequest } from "@/lib/auth";
import { submitLessonTurn } from "@/lib/lesson/runtime";

const schema = z.object({
  mode: z.enum(["voice", "text"]),
  payloadRef: z.string().min(1),
  durationSec: z.number().positive().max(1800).optional(),
});

type Context = {
  params: Promise<{ sessionId: string }>;
};

export async function POST(req: NextRequest, context: Context) {
  const student = await getStudentFromRequest();
  if (!student) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sessionId } = await context.params;

  try {
    const body = schema.parse(await req.json());
    const payload = await submitLessonTurn({
      sessionId,
      studentId: student.studentId,
      mode: body.mode,
      payloadRef: body.payloadRef,
      durationSec: body.durationSec,
    });

    return NextResponse.json({
      turnResult: payload.turnResult,
      nextAction: payload.nextAction,
      lessonSession: payload.lessonSession,
      activeStep: payload.activeStep,
      missionHeader: payload.missionHeader,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to submit turn";
    const status =
      message === "ATTEMPT_NOT_READY"
        ? 409
        : message === "ATTEMPT_NOT_FOUND"
        ? 404
        : message === "LESSON_NOT_FOUND"
        ? 404
        : 400;

    return NextResponse.json({ error: message }, { status });
  }
}

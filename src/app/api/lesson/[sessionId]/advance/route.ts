import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getStudentFromRequest } from "@/lib/auth";
import { advanceLessonRuntime } from "@/lib/lesson/runtime";

const schema = z.object({
  action: z.enum(["next_turn", "next_step"]),
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
    const payload = await advanceLessonRuntime({
      sessionId,
      studentId: student.studentId,
      action: body.action,
    });

    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to advance lesson" },
      { status: 400 },
    );
  }
}

import { NextResponse } from "next/server";
import { getStudentFromRequest } from "@/lib/auth";
import { getLessonRuntimeState } from "@/lib/lesson/runtime";

type Context = {
  params: Promise<{ sessionId: string }>;
};

export async function GET(_: Request, context: Context) {
  const student = await getStudentFromRequest();
  if (!student) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sessionId } = await context.params;

  try {
    const payload = await getLessonRuntimeState({
      sessionId,
      studentId: student.studentId,
    });
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to fetch lesson state" },
      { status: 404 },
    );
  }
}

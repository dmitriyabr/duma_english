import { NextResponse } from "next/server";
import { getStudentFromRequest } from "@/lib/auth";
import { getActiveLessonRuntime } from "@/lib/lesson/runtime";

export async function GET() {
  const student = await getStudentFromRequest();
  if (!student) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await getActiveLessonRuntime(student.studentId);
  return NextResponse.json({
    lessonSession: payload.lessonSession,
    activeStep: payload.activeStep,
    missionHeader: payload.missionHeader,
  });
}

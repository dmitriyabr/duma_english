import { NextResponse } from "next/server";
import { getStudentFromRequest } from "@/lib/auth";
import { getPlacementSession, startPlacement } from "@/lib/placement";

export async function POST() {
  const student = await getStudentFromRequest();
  if (!student) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = await startPlacement(student.studentId);
  const state = await getPlacementSession(student.studentId, session.id);
  const currentQuestion = state?.question || null;

  return NextResponse.json({
    placementId: session.id,
    status: session.status,
    theta: session.theta,
    sigma: session.sigma,
    currentIndex: session.currentIndex,
    totalQuestions: state?.totalQuestions || 14,
    currentQuestion,
    nextItem: currentQuestion,
  });
}

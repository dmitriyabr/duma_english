import { NextResponse } from "next/server";
import { getStudentFromRequest } from "@/lib/auth";
import { getPlacementQuestions, startPlacement } from "@/lib/placement";

export async function POST() {
  const student = await getStudentFromRequest();
  if (!student) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = await startPlacement(student.studentId);
  const questions = getPlacementQuestions();
  const currentQuestion = questions[session.currentIndex] || null;

  return NextResponse.json({
    placementId: session.id,
    status: session.status,
    currentIndex: session.currentIndex,
    totalQuestions: questions.length,
    currentQuestion,
  });
}

import { NextResponse } from "next/server";
import { getStudentFromRequest } from "@/lib/auth";
import { getPlacementSession } from "@/lib/placement";

type PlacementRouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_: Request, context: PlacementRouteContext) {
  const { id } = await context.params;
  const student = await getStudentFromRequest();
  if (!student) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const state = await getPlacementSession(student.studentId, id);
  if (!state) {
    return NextResponse.json({ error: "Placement session not found" }, { status: 404 });
  }

  return NextResponse.json({
    placementId: state.session.id,
    status: state.session.status,
    theta: state.session.theta,
    sigma: state.session.sigma,
    currentIndex: state.session.currentIndex,
    questionCount: state.session.questionCount,
    totalQuestions: state.totalQuestions,
    currentQuestion: state.question,
    nextItem: state.question,
    confidenceEstimate: state.session.confidenceEstimate,
    stageEstimate: state.session.stageEstimate,
    result: state.session.resultJson,
  });
}

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
    currentIndex: state.session.currentIndex,
    totalQuestions: state.totalQuestions,
    currentQuestion: state.question,
    result: state.session.resultJson,
  });
}

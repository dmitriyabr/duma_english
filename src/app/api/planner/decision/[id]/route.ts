import { NextResponse } from "next/server";
import { getStudentFromRequest } from "@/lib/auth";
import { getPlannerDecisionById } from "@/lib/gse/planner";

type PlannerDecisionContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_: Request, context: PlannerDecisionContext) {
  const student = await getStudentFromRequest();
  if (!student) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const decision = await getPlannerDecisionById(id, student.studentId);
  if (!decision) {
    return NextResponse.json({ error: "Decision not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: decision.id,
    decisionTs: decision.decisionTs,
    chosenTaskType: decision.chosenTaskType,
    expectedGain: decision.expectedGain,
    estimatedDifficulty: decision.estimatedDifficulty,
    targetNodeIds: decision.targetNodeIds,
    selectionReason: decision.selectionReason,
    primaryGoal: decision.primaryGoal,
    fallbackUsed: decision.fallbackUsed,
    utility: decision.utilityJson,
    candidateSet: decision.candidateSetJson,
    taskInstance: decision.taskInstance,
  });
}

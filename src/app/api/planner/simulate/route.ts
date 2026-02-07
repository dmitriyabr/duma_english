import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getStudentFromRequest } from "@/lib/auth";
import { buildLearningPlan } from "@/lib/adaptive";
import { planNextTaskDecision } from "@/lib/gse/planner";

const schema = z.object({
  requestedType: z.string().min(2).optional(),
  candidateTaskTypes: z.array(z.string().min(2)).max(10).optional(),
});

export async function POST(req: NextRequest) {
  const student = await getStudentFromRequest();
  if (!student) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = schema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const learningPlan = await buildLearningPlan({
    studentId: student.studentId,
    requestedType: body.data.requestedType || null,
  });
  const decision = await planNextTaskDecision({
    studentId: student.studentId,
    stage: learningPlan.currentStage,
    ageBand: learningPlan.ageBand,
    candidateTaskTypes:
      body.data.candidateTaskTypes && body.data.candidateTaskTypes.length > 0
        ? body.data.candidateTaskTypes
        : learningPlan.recommendedTaskTypes,
    requestedType: body.data.requestedType || null,
  });

  return NextResponse.json({
    stage: learningPlan.currentStage,
    ageBand: learningPlan.ageBand,
    decisionId: decision.decisionId,
    chosenTaskType: decision.chosenTaskType,
    expectedGain: decision.expectedGain,
    targetNodeIds: decision.targetNodeIds,
    primaryGoal: decision.primaryGoal,
    candidateScores: decision.candidateScores,
  });
}

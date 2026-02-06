import { NextResponse } from "next/server";
import { getStudentFromRequest } from "@/lib/auth";
import { buildLearningPlan, recomputeMastery } from "@/lib/adaptive";

export async function POST() {
  const student = await getStudentFromRequest();
  if (!student) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const mastery = await recomputeMastery(student.studentId);
  const plan = await buildLearningPlan({ studentId: student.studentId });

  return NextResponse.json({
    stage: mastery.stage,
    averageMastery: mastery.averageMastery,
    mastery: mastery.mastery,
    nextTaskReason: plan.nextTaskReason,
    recommendedTaskTypes: plan.recommendedTaskTypes,
    weakestSkills: plan.weakestSkills,
  });
}

import { NextResponse } from "next/server";
import { getStudentFromRequest } from "@/lib/auth";
import { buildLearningPlan } from "@/lib/adaptive";
import { projectLearnerStageFromGse } from "@/lib/gse/stageProjection";

export async function GET(req: Request) {
  const student = await getStudentFromRequest();
  if (!student) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const requestedType = url.searchParams.get("type");
  const plan = await buildLearningPlan({
    studentId: student.studentId,
    requestedType,
  });
  const projection = await projectLearnerStageFromGse(student.studentId);

  return NextResponse.json({
    studentId: student.studentId,
    stage: plan.currentStage,
    ageBand: plan.ageBand,
    cycleWeek: plan.cycleWeek,
    weakestSkills: plan.weakestSkills,
    targetWords: plan.targetWords,
    recommendedTaskTypes: plan.recommendedTaskTypes,
    nextTaskReason: plan.nextTaskReason,
    skillMatrix: plan.skillMatrix,
    mastery: projection.derivedSkills.map((row) => ({
      skillKey: row.skillKey,
      masteryScore: row.current,
      reliability: row.reliability,
      evidenceCount: row.sampleCount,
      source: row.source,
    })),
  });
}

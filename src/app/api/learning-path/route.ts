import { NextResponse } from "next/server";
import { getStudentFromRequest } from "@/lib/auth";
import { buildLearningPlan } from "@/lib/adaptive";
import { prisma } from "@/lib/db";

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
  const mastery = await prisma.studentSkillMastery.findMany({
    where: { studentId: student.studentId },
    orderBy: { masteryScore: "asc" },
  });

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
    mastery: mastery.map((row) => ({
      skillKey: row.skillKey,
      masteryScore: row.masteryScore,
      reliability: row.reliability,
      evidenceCount: row.evidenceCount,
    })),
  });
}

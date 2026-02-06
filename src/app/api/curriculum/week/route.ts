import { NextResponse } from "next/server";
import { getStudentFromRequest } from "@/lib/auth";
import { ensureLearnerProfile } from "@/lib/adaptive";
import { AgeBand, CEFRStage, buildWeeklyCycle, getCurriculumWeek, getSkillMatrix } from "@/lib/curriculum";

function isStage(value: string): value is CEFRStage {
  return value === "A0" || value === "A1" || value === "A2" || value === "B1";
}

function isAgeBand(value: string): value is AgeBand {
  return value === "6-8" || value === "9-11" || value === "12-14";
}

export async function GET(req: Request) {
  const student = await getStudentFromRequest();
  if (!student) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const profile = await ensureLearnerProfile(student.studentId);
  const url = new URL(req.url);
  const stageParam = url.searchParams.get("stage");
  const ageBandParam = url.searchParams.get("ageBand");
  const weekParam = Number(url.searchParams.get("week") || profile.cycleWeek);

  const stage = stageParam && isStage(stageParam) ? stageParam : (isStage(profile.stage) ? profile.stage : "A0");
  const ageBand =
    ageBandParam && isAgeBand(ageBandParam) ? ageBandParam : (isAgeBand(profile.ageBand) ? profile.ageBand : "9-11");
  const week = Number.isFinite(weekParam) ? Math.max(1, Math.min(12, Math.floor(weekParam))) : 1;

  const currentWeek = getCurriculumWeek({ stage, ageBand, week });
  const weeklyPlan = buildWeeklyCycle(stage, ageBand);

  return NextResponse.json({
    stage,
    ageBand,
    week,
    skillMatrix: getSkillMatrix(stage, ageBand),
    currentWeek,
    weeklyPlan,
  });
}

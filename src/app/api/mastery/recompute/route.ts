import { NextResponse } from "next/server";
import { getStudentFromRequest } from "@/lib/auth";
import { recomputeMastery } from "@/lib/adaptive";
import { nextTargetNodesForStudent } from "@/lib/gse/planner";
import { projectLearnerStageFromGse } from "@/lib/gse/stageProjection";

export async function POST() {
  const student = await getStudentFromRequest();
  if (!student) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const mastery = await recomputeMastery(student.studentId);
  const projection = await projectLearnerStageFromGse(student.studentId);
  const nextTargets = await nextTargetNodesForStudent(student.studentId, 5);

  return NextResponse.json({
    stage: projection.promotionStage,
    placementStage: projection.placementStage,
    promotionStage: projection.promotionStage,
    placementConfidence: projection.placementConfidence,
    placementUncertainty: projection.placementUncertainty,
    averageMastery: mastery.averageMastery,
    mastery: mastery.mastery,
    nextTargetNodes: nextTargets,
    promotionReadiness: {
      targetStage: projection.targetStage,
      ready: projection.promotionReady,
      score: projection.score,
      blockers: projection.blockedByNodeDescriptors,
    },
  });
}

import { NextResponse } from "next/server";
import { getStudentFromRequest } from "@/lib/auth";
import { finishPlacement } from "@/lib/placement/irt";
import { canTransitionPlacementStatus } from "@/lib/placement/shared";
import type { PlacementSessionStatus } from "@/lib/placement/types";
import { prisma } from "@/lib/db";

type PlacementFinishContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_: Request, context: PlacementFinishContext) {
  const { id } = await context.params;
  const student = await getStudentFromRequest();
  if (!student) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = await prisma.placementSession.findUnique({ where: { id } });
  if (!session || session.studentId !== student.studentId) {
    return NextResponse.json({ error: "Placement session not found" }, { status: 404 });
  }
  if (
    !canTransitionPlacementStatus(
      "irt",
      session.status as PlacementSessionStatus,
      "completed"
    )
  ) {
    return NextResponse.json({ error: "Placement session can not be finished" }, { status: 409 });
  }

  try {
    const result = await finishPlacement(id);
    return NextResponse.json({
      placementId: id,
      status: "completed",
      result,
      provisionalStage: result.provisionalStage,
      promotionStage: result.promotionStage,
      confidence: result.confidence,
      uncertainty: result.uncertainty,
      coverage: result.coverage,
      reliability: result.reliability,
      blockedBundles: result.blockedBundles,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to finish placement" },
      { status: 400 }
    );
  }
}

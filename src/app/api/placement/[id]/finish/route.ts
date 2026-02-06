import { NextResponse } from "next/server";
import { getStudentFromRequest } from "@/lib/auth";
import { finishPlacement } from "@/lib/placement";
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

  try {
    const result = await finishPlacement(id);
    return NextResponse.json({
      placementId: id,
      status: "completed",
      result,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to finish placement" },
      { status: 400 }
    );
  }
}

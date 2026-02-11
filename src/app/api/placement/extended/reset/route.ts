import { NextResponse } from "next/server";
import { getStudentFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST() {
  const student = await getStudentFromRequest();
  if (!student) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prisma.placementSession.updateMany({
    where: {
      studentId: student.studentId,
      placementMode: "placement_extended",
      status: "started",
    },
    data: { status: "cancelled" },
  });

  return NextResponse.json({ ok: true });
}

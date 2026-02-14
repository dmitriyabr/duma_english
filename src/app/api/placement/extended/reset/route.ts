import { NextResponse } from "next/server";
import { getStudentFromRequest } from "@/lib/auth";
import { resetPlacementExtendedSessions } from "@/lib/placement/extended";

export async function POST() {
  const student = await getStudentFromRequest();
  if (!student) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await resetPlacementExtendedSessions(student.studentId);

  return NextResponse.json({ ok: true });
}

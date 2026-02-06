import { NextResponse } from "next/server";
import { getStudentFromRequest } from "@/lib/auth";
import { getStudentProgress } from "@/lib/progress";

export async function GET() {
  const student = await getStudentFromRequest();
  if (!student) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const progress = await getStudentProgress(student.studentId);
  return NextResponse.json(progress);
}

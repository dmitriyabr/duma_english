import { NextResponse } from "next/server";
import { getTeacherFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET() {
  const teacher = await getTeacherFromRequest();
  if (!teacher) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const row = await prisma.teacher.findUnique({
    where: { id: teacher.teacherId },
    select: { id: true, name: true, email: true },
  });
  if (!row) {
    return NextResponse.json({ error: "Teacher not found" }, { status: 401 });
  }

  return NextResponse.json({
    teacherId: row.id,
    name: row.name,
    email: row.email,
  });
}

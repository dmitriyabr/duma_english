import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getTeacherFromRequest } from "@/lib/auth";

function generateLoginCode(length = 6): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

async function ensureTeacherCanAccessStudent(
  teacherId: string,
  studentId: string
) {
  const student = await prisma.student.findFirst({
    where: { id: studentId },
    include: { class: { select: { teacherId: true } } },
  });
  if (!student || student.class.teacherId !== teacherId) return null;
  return student;
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ studentId: string }> }
) {
  const teacher = await getTeacherFromRequest();
  if (!teacher) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { studentId } = await params;
  const student = await ensureTeacherCanAccessStudent(
    teacher.teacherId,
    studentId
  );
  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  let loginCode: string | null = null;
  for (let i = 0; i < 5; i += 1) {
    const code = generateLoginCode();
    const existing = await prisma.student.findFirst({
      where: { loginCode: code, id: { not: studentId } },
    });
    if (!existing) {
      loginCode = code;
      break;
    }
  }
  if (!loginCode) {
    return NextResponse.json(
      { error: "Unable to generate code" },
      { status: 500 }
    );
  }

  await prisma.student.update({
    where: { id: studentId },
    data: { loginCode },
  });

  return NextResponse.json({ loginCode });
}

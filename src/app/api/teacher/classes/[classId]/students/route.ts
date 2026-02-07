import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getTeacherFromRequest } from "@/lib/auth";

const schema = z.object({
  displayName: z.string().min(1).max(80),
});

function generateLoginCode(length = 6): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

async function ensureTeacherClass(teacherId: string, classId: string) {
  return prisma.class.findFirst({
    where: { id: classId, teacherId },
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ classId: string }> }
) {
  const teacher = await getTeacherFromRequest();
  if (!teacher) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { classId } = await params;
  const cls = await ensureTeacherClass(teacher.teacherId, classId);
  if (!cls) {
    return NextResponse.json({ error: "Class not found" }, { status: 404 });
  }

  try {
    const body = schema.parse(await req.json());
    const name = body.displayName.trim();
    let loginCode: string | null = null;
    for (let i = 0; i < 5; i += 1) {
      const code = generateLoginCode();
      const existing = await prisma.student.findUnique({ where: { loginCode: code } });
      if (!existing) {
        loginCode = code;
        break;
      }
    }
    if (!loginCode) {
      return NextResponse.json({ error: "Unable to generate code" }, { status: 500 });
    }
    const student = await prisma.student.create({
      data: {
        classId: cls.id,
        displayName: name,
        loginCode,
      },
    });
    return NextResponse.json({
      id: student.id,
      displayName: student.displayName,
      createdAt: student.createdAt,
      loginCode: student.loginCode,
    });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

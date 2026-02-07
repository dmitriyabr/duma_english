import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getTeacherFromRequest } from "@/lib/auth";

const schema = z.object({
  maxUses: z.number().int().positive().optional(),
});

function generateCode(length = 6) {
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
    const body = schema.safeParse(await req.json());
    const maxUses = body.success ? body.data.maxUses : undefined;

    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + 6);

    let classCode: { code: string; expiresAt: Date | null } | null = null;
    for (let i = 0; i < 5; i += 1) {
      const code = generateCode();
      try {
        const created = await prisma.classCode.create({
          data: {
            classId: cls.id,
            code,
            maxUses,
            expiresAt,
          },
        });
        classCode = { code: created.code, expiresAt: created.expiresAt };
        break;
      } catch {
        // retry on collision
      }
    }

    if (!classCode) {
      return NextResponse.json(
        { error: "Unable to generate code" },
        { status: 500 }
      );
    }

    return NextResponse.json(classCode);
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

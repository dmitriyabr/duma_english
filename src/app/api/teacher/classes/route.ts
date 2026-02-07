import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getTeacherFromRequest } from "@/lib/auth";

export async function GET() {
  const teacher = await getTeacherFromRequest();
  if (!teacher) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const classes = await prisma.class.findMany({
    where: { teacherId: teacher.teacherId },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { students: true } },
      students: {
        select: { id: true },
        take: 1,
      },
    },
  })

  const classIds = classes.map((c) => c.id);
  const lastAttempts =
    classIds.length > 0
      ? await prisma.attempt.findMany({
          where: {
            student: { classId: { in: classIds } },
            status: "completed",
          },
          select: { createdAt: true, student: { select: { classId: true } } },
          orderBy: { createdAt: "desc" },
        })
      : [];

  const latestByClass = new Map<string, Date>();
  for (const a of lastAttempts) {
    const cid = a.student.classId;
    if (!latestByClass.has(cid)) latestByClass.set(cid, a.createdAt);
  }

  const list = classes.map((c) => ({
    id: c.id,
    name: c.name,
    createdAt: c.createdAt,
    studentCount: c._count.students,
    lastActivityAt: latestByClass.get(c.id) ?? null,
  }));

  return NextResponse.json({ classes: list });
}

const createSchema = z.object({
  name: z.string().min(1).max(200),
});

export async function POST(req: NextRequest) {
  const teacher = await getTeacherFromRequest();
  if (!teacher) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = createSchema.parse(await req.json());
    const cls = await prisma.class.create({
      data: {
        name: body.name.trim(),
        teacherId: teacher.teacherId,
      },
    });
    return NextResponse.json({ classId: cls.id, name: cls.name });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

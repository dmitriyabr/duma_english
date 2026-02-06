import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { checkBasicAuth } from "@/lib/adminAuth";

const schema = z.object({
  teacherName: z.string().min(1),
  className: z.string().min(1),
});

export async function POST(req: NextRequest) {
  if (!checkBasicAuth(req)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const body = schema.parse(await req.json());
    let teacher = await prisma.teacher.findFirst({
      where: { name: body.teacherName },
    });

    if (!teacher) {
      teacher = await prisma.teacher.create({
        data: { name: body.teacherName },
      });
    }

    const newClass = await prisma.class.create({
      data: {
        name: body.className,
        teacherId: teacher.id,
      },
    });

    return NextResponse.json({ classId: newClass.id });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/teacherAuth";
import {
  issueTeacherToken,
  setTeacherSessionCookie,
} from "@/lib/auth";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const body = schema.parse(await req.json());
    const email = body.email.trim().toLowerCase();

    const teacher = await prisma.teacher.findUnique({
      where: { email },
    });

    if (
      !teacher ||
      !teacher.passwordHash ||
      !(await verifyPassword(body.password, teacher.passwordHash))
    ) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    const token = await issueTeacherToken({ teacherId: teacher.id });
    await setTeacherSessionCookie(token);

    return NextResponse.json({
      teacherId: teacher.id,
      name: teacher.name,
    });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

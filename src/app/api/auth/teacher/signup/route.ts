import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/teacherAuth";
import {
  issueTeacherToken,
  setTeacherSessionCookie,
} from "@/lib/auth";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "At least 8 characters"),
  name: z.string().min(1).max(100),
});

export async function POST(req: NextRequest) {
  try {
    const body = schema.parse(await req.json());
    const email = body.email.trim().toLowerCase();
    const name = body.name.trim();

    const existing = await prisma.teacher.findUnique({
      where: { email },
    });
    if (existing) {
      return NextResponse.json(
        { error: "This email is already registered" },
        { status: 409 }
      );
    }

    const passwordHash = await hashPassword(body.password);
    const teacher = await prisma.teacher.create({
      data: {
        email,
        name,
        passwordHash,
      },
    });

    const token = await issueTeacherToken({ teacherId: teacher.id });
    await setTeacherSessionCookie(token);

    return NextResponse.json({
      teacherId: teacher.id,
      name: teacher.name,
    });
  } catch (e) {
    if (e instanceof z.ZodError) {
      const msg = e.errors.map((x) => x.message).join("; ");
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

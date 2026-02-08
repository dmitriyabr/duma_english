import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { issueStudentToken, setSessionCookie } from "@/lib/auth";
import { ensureLearnerProfile } from "@/lib/adaptive";

const schema = z.object({
  code: z.string().min(3).max(20),
  ageBand: z.enum(["6-8", "9-11", "12-14"]).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = schema.parse(await req.json());
    const normalizedCode = body.code.trim().toUpperCase();

    const student = await prisma.student.findUnique({
      where: { loginCode: normalizedCode },
      select: { id: true, classId: true },
    });

    if (!student) {
      return NextResponse.json(
        { error: "Invalid code. Use the personal code from your teacher." },
        { status: 401 }
      );
    }

    const profile = await ensureLearnerProfile(
      student.id,
      body.ageBand as "6-8" | "9-11" | "12-14" | undefined
    );
    if (body.ageBand && profile.ageBand !== body.ageBand) {
      await prisma.learnerProfile.update({
        where: { id: profile.id },
        data: { ageBand: body.ageBand },
      });
    }

    const token = await issueStudentToken({
      studentId: student.id,
      classId: student.classId,
    });

    await setSessionCookie(token);

    return NextResponse.json({ studentId: student.id, sessionToken: token });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

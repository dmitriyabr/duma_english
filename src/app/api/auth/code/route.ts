import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { issueStudentToken, setSessionCookie } from "@/lib/auth";
import { ensureLearnerProfile } from "@/lib/adaptive";
import { AgeBand } from "@/lib/curriculum";

const schema = z.object({
  code: z.string().min(3).max(20),
  displayName: z.string().min(1).max(40).optional(),
  ageBand: z.enum(["6-8", "9-11", "12-14"]).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = schema.parse(await req.json());
    const now = new Date();

    const normalizedCode = body.code.trim().toUpperCase();
    const classCode = await prisma.classCode.findFirst({
      where: {
        code: normalizedCode,
        status: "active",
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      include: { class: true },
    });

    if (!classCode) {
      return NextResponse.json({ error: "Invalid or expired code" }, { status: 401 });
    }

    if (classCode.maxUses && classCode.usesCount >= classCode.maxUses) {
      return NextResponse.json({ error: "Code usage limit reached" }, { status: 401 });
    }

    const displayName = body.displayName?.trim() || "Student";
    const ageBand = body.ageBand as AgeBand | undefined;

    let student = await prisma.student.findFirst({
      where: {
        classId: classCode.classId,
        displayName,
      },
    });

    if (!student) {
      student = await prisma.student.create({
        data: {
          classId: classCode.classId,
          displayName,
        },
      });

      await prisma.classCode.update({
        where: { id: classCode.id },
        data: { usesCount: { increment: 1 } },
      });
    }

    const profile = await ensureLearnerProfile(student.id, ageBand);
    if (ageBand && profile.ageBand !== ageBand) {
      await prisma.learnerProfile.update({
        where: { id: profile.id },
        data: { ageBand },
      });
    }

    const token = await issueStudentToken({
      studentId: student.id,
      classId: classCode.classId,
    });

    await setSessionCookie(token);

    return NextResponse.json({ studentId: student.id, sessionToken: token });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

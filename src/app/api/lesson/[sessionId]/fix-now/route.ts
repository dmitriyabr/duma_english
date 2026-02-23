import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getStudentFromRequest } from "@/lib/auth";
import { triggerFixNow } from "@/lib/lesson/runtime";

const schema = z.object({
  sourceTurnId: z.string().min(1),
});

type Context = {
  params: Promise<{ sessionId: string }>;
};

export async function POST(req: NextRequest, context: Context) {
  const student = await getStudentFromRequest();
  if (!student) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { sessionId } = await context.params;

  try {
    const body = schema.parse(await req.json());
    const payload = await triggerFixNow({
      sessionId,
      studentId: student.studentId,
      sourceTurnId: body.sourceTurnId,
    });

    return NextResponse.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to start fix-now";
    const status = message.includes("NOT_FOUND") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

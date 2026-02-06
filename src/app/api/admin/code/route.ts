import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { checkBasicAuth } from "@/lib/adminAuth";

const schema = z.object({
  classId: z.string().min(1),
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

export async function POST(req: NextRequest) {
  if (!checkBasicAuth(req)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const body = schema.parse(await req.json());
    const classExists = await prisma.class.findUnique({
      where: { id: body.classId },
    });
    if (!classExists) {
      return NextResponse.json({ error: "Class not found" }, { status: 404 });
    }
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + 6);

    let classCode = null as null | { code: string; expiresAt: Date | null };
    for (let i = 0; i < 5; i += 1) {
      const code = generateCode();
      try {
        classCode = await prisma.classCode.create({
          data: {
            classId: body.classId,
            code,
            maxUses: body.maxUses,
            expiresAt,
          },
        });
        break;
      } catch {
        // retry if code collision
      }
    }

    if (!classCode) {
      return NextResponse.json({ error: "Unable to generate code" }, { status: 500 });
    }

    return NextResponse.json({ code: classCode.code, expiresAt: classCode.expiresAt });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

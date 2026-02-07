import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getStudentFromRequest } from "@/lib/auth";

type GseNodeRouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_: Request, context: GseNodeRouteContext) {
  const { id } = await context.params;
  const student = await getStudentFromRequest();
  if (!student) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const node = await prisma.gseNode.findUnique({
    where: { nodeId: id },
    include: {
      aliases: true,
    },
  });
  if (!node) {
    return NextResponse.json({ error: "Node not found" }, { status: 404 });
  }

  const mastery = await prisma.studentGseMastery.findUnique({
    where: {
      studentId_nodeId: {
        studentId: student.studentId,
        nodeId: id,
      },
    },
  });

  return NextResponse.json({
    node,
    mastery,
  });
}


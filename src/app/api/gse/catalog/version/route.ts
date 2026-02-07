import { NextResponse } from "next/server";
import { getStudentFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET() {
  const student = await getStudentFromRequest();
  if (!student) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const latest = await prisma.gseCatalogVersion.findFirst({
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: { nodes: true },
      },
    },
  });

  if (!latest) {
    return NextResponse.json({
      version: null,
      nodeCount: 0,
    });
  }

  return NextResponse.json({
    version: latest.version,
    source: latest.source,
    createdAt: latest.createdAt,
    nodeCount: latest._count.nodes,
  });
}


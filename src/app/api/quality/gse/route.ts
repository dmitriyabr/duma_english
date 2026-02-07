import { NextResponse } from "next/server";
import { getStudentFromRequest } from "@/lib/auth";
import { buildGseQualityReport } from "@/lib/gse/quality";

export async function GET() {
  const student = await getStudentFromRequest();
  if (!student) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const report = await buildGseQualityReport();
  return NextResponse.json(report);
}

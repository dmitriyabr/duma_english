import { NextRequest, NextResponse } from "next/server";
import { getStudentFromRequest } from "@/lib/auth";
import { buildOffPolicyEvaluationReport } from "@/lib/ope/offPolicyEvaluation";

function parseIntParam(value: string | null, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.floor(parsed);
}

export async function GET(req: NextRequest) {
  const student = await getStudentFromRequest();
  if (!student) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const windowDays = parseIntParam(url.searchParams.get("windowDays"), 90);
  const limit = parseIntParam(url.searchParams.get("limit"), 10000);
  const bootstrapSamples = parseIntParam(url.searchParams.get("bootstrapSamples"), 400);

  const report = await buildOffPolicyEvaluationReport({
    windowDays,
    limit,
    bootstrapSamples,
  });
  return NextResponse.json(report);
}

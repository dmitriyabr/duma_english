import { NextResponse } from "next/server";
import { getStudentFromRequest } from "@/lib/auth";
import { getModelPromptRegistry } from "@/lib/registry/modelPromptRegistry";

export async function GET() {
  const student = await getStudentFromRequest();
  if (!student) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const registry = getModelPromptRegistry();
  return NextResponse.json(registry);
}

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { prisma } from "@/lib/db";
import { planNextTaskDecision } from "@/lib/gse/planner";
import { projectLearnerStageFromGse } from "@/lib/gse/stageProjection";

const DEFAULT_LOG_PATH = "docs/reports/CH45_SLO_CANARY_LOG.ndjson";

async function main() {
  const argv = process.argv.slice(2);
  const logPath = resolve(process.cwd(), argv[argv.indexOf("--output") + 1] ?? DEFAULT_LOG_PATH);

  const student = await prisma.student.findFirst({
    where: { id: { not: undefined } },
    select: { id: true },
  });
  if (!student) {
    console.log(JSON.stringify({ event: "slo_canary_skipped", reason: "no_student" }));
    process.exit(0);
  }

  const projection = await projectLearnerStageFromGse(student.id);
  const stage = projection.promotionStage ?? "A1";
  const allowed = [
    "read_aloud",
    "target_vocab",
    "qa_prompt",
    "role_play",
    "topic_talk",
    "writing_prompt",
    "reading_comprehension",
    "listening_comprehension",
  ];

  const startedAt = Date.now();
  try {
    await planNextTaskDecision({
      studentId: student.id,
      stage,
      candidateTaskTypes: allowed,
      useRuleOnly: true,
    });
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const entry = {
      event: "slo_canary",
      ts: new Date().toISOString(),
      studentId: student.id,
      latencyMs,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
    mkdirSync(dirname(logPath), { recursive: true });
    appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf8");
    console.log(JSON.stringify(entry));
    process.exit(1);
  }

  const latencyMs = Date.now() - startedAt;
  const entry = {
    event: "slo_canary",
    ts: new Date().toISOString(),
    studentId: student.id,
    latencyMs,
    success: true,
  };
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf8");
  console.log(JSON.stringify(entry));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

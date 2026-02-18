import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { prisma } from "../lib/db";
import { buildRetentionCohortReport } from "../lib/quality/retentionCohortReport";

function parseNumberFlag(argv: string[], flag: string) {
  const idx = argv.indexOf(flag);
  if (idx < 0) return null;
  const raw = argv[idx + 1];
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseStringFlag(argv: string[], flag: string) {
  const idx = argv.indexOf(flag);
  if (idx < 0) return null;
  return argv[idx + 1] || null;
}

async function main() {
  const argv = process.argv.slice(2);
  const windowDays = Math.max(7, Math.min(365, Math.floor(parseNumberFlag(argv, "--window-days") ?? 90)));
  const limit = Math.max(100, Math.min(200000, Math.floor(parseNumberFlag(argv, "--limit") ?? 60000)));
  const outputPath =
    parseStringFlag(argv, "--output") ||
    "docs/reports/CH29_RETENTION_COHORT_REPORT.json";

  const report = await buildRetentionCohortReport({
    windowDays,
    limit,
  });

  const resolvedPath = resolve(outputPath);
  mkdirSync(dirname(resolvedPath), { recursive: true });
  writeFileSync(resolvedPath, JSON.stringify(report, null, 2), "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputPath: resolvedPath,
        summary: {
          totalEvidenceRows: report.totalEvidenceRows,
          totalDueProbeCount: report.totalDueProbeCount,
          totalEvaluatedProbeCount: report.totalEvaluatedProbeCount,
          totalPassedCount: report.totalPassedCount,
          overallPassRate: report.overallPassRate,
          overallCompletionRate: report.overallCompletionRate,
          cohorts: report.cohorts.length,
        },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { prisma } from "../lib/db";
import { buildWritingProgressionDashboard } from "../lib/quality/writingProgressionDashboard";

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
  const windowDays = Math.max(1, Math.min(365, Math.floor(parseNumberFlag(argv, "--window-days") ?? 30)));
  const limit = Math.max(100, Math.min(100000, Math.floor(parseNumberFlag(argv, "--limit") ?? 20000)));
  const outputPath =
    parseStringFlag(argv, "--output") ||
    "docs/reports/CH37_WRITING_PROGRESSION_DASHBOARD.json";

  const report = await buildWritingProgressionDashboard({
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
          totalWritingAttempts: report.totalWritingAttempts,
          completedWritingAttempts: report.completedWritingAttempts,
          averageTaskScore: report.averageTaskScore,
          averageLanguageScore: report.averageLanguageScore,
          averageWordCount: report.averageWordCount,
          revisionSubmissionRate: report.revisionSubmissionRate,
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

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { prisma } from "../lib/db";
import { syncMemorySchedulerForStudents } from "../lib/memory/scheduler";
import { buildMemorySchedulerDashboardReport } from "../lib/quality/memorySchedulerDashboard";

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

function hasFlag(argv: string[], flag: string) {
  return argv.includes(flag);
}

async function main() {
  const argv = process.argv.slice(2);
  const windowDays = Math.max(1, Math.min(365, Math.floor(parseNumberFlag(argv, "--window-days") ?? 30)));
  const limit = Math.max(100, Math.min(100000, Math.floor(parseNumberFlag(argv, "--limit") ?? 20000)));
  const outputPath =
    parseStringFlag(argv, "--output") ||
    "docs/reports/CH28_MEMORY_SCHEDULER_REPORT.json";
  const syncEnabled = hasFlag(argv, "--sync");
  const maxStudents = Math.max(1, Math.min(5000, Math.floor(parseNumberFlag(argv, "--student-limit") ?? 200)));
  const maxCandidatesPerStudent = Math.max(
    10,
    Math.min(500, Math.floor(parseNumberFlag(argv, "--max-candidates-per-student") ?? 120)),
  );

  const syncResult = syncEnabled
    ? await syncMemorySchedulerForStudents({
        maxStudents,
        maxCandidatesPerStudent,
      })
    : null;

  const report = await buildMemorySchedulerDashboardReport({
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
        syncEnabled,
        syncSummary: syncResult
          ? {
              studentCount: syncResult.studentCount,
              totals: syncResult.totals,
            }
          : null,
        summary: {
          totalQueueItems: report.totalQueueItems,
          openCount: report.openCount,
          dueMissCount: report.dueMissCount,
          dueMissRate: report.dueMissRate,
          fragileOpenCount: report.fragileOpenCount,
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

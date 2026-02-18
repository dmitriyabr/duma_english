import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { prisma } from "../lib/db";
import { buildSelfRepairBudgetTelemetryReport } from "../lib/quality/selfRepairBudgetTelemetry";

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
  const cycleLimit = Math.max(10, Math.min(50000, Math.floor(parseNumberFlag(argv, "--cycle-limit") ?? 5000)));
  const queueLimit = Math.max(10, Math.min(50000, Math.floor(parseNumberFlag(argv, "--queue-limit") ?? 5000)));
  const outputPath =
    parseStringFlag(argv, "--output") ||
    "docs/reports/CH27_SELF_REPAIR_BUDGET_TELEMETRY_REPORT.json";

  const report = await buildSelfRepairBudgetTelemetryReport({
    windowDays,
    cycleLimit,
    queueLimit,
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
          totalCycles: report.totalCycles,
          budgetExhaustedCount: report.budgetExhaustedCount,
          escalatedCount: report.escalatedCount,
          budgetExhaustedRate: report.budgetExhaustedRate,
        },
      },
      null,
      2
    )
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

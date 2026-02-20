import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildOperationalPlaybooksReport } from "@/lib/quality/operationalPlaybooksReport";

const DEFAULT_OUTPUT = "docs/reports/CH44_OPERATIONAL_PLAYBOOKS_REPORT.json";

function parseIntArg(argv: string[], flag: string, fallback: number): number {
  const idx = argv.indexOf(flag);
  if (idx < 0) return fallback;
  const v = argv[idx + 1];
  if (v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : fallback;
}

async function main() {
  const argv = process.argv.slice(2);
  const windowDays = parseIntArg(argv, "--window-days", 14);
  const limit = parseIntArg(argv, "--limit", 2000);
  const outputPath = resolve(process.cwd(), argv[argv.indexOf("--output") + 1] ?? DEFAULT_OUTPUT);

  const report = await buildOperationalPlaybooksReport({ windowDays, limit });
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify({ event: "operational_playbooks_report", path: outputPath, summary: report.summary }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

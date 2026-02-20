import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildSloDashboard } from "@/lib/quality/sloDashboard";

const DEFAULT_OUTPUT = "docs/reports/CH45_SLO_DASHBOARD.json";

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
  const windowDays = parseIntArg(argv, "--window-days", 1);
  const outputPath = resolve(process.cwd(), argv[argv.indexOf("--output") + 1] ?? DEFAULT_OUTPUT);

  const dashboard = await buildSloDashboard({ windowDays });
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(dashboard, null, 2), "utf8");
  console.log(JSON.stringify({ event: "slo_dashboard_report", path: outputPath, modules: dashboard.modules }));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

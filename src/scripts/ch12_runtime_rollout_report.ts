import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildRuntimeRolloutDashboardReport } from "@/lib/quality/runtimeRolloutDashboard";

const DEFAULT_OUTPUT = "docs/reports/CH12_RUNTIME_ROLLOUT_DASHBOARD.json";

function parseIntArg(name: string, fallback: number) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const raw = process.argv[index + 1];
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.floor(parsed);
}

function parseStringArg(name: string, fallback: string) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  return process.argv[index + 1] || fallback;
}

async function main() {
  const windowDays = parseIntArg("--windowDays", 30);
  const limit = parseIntArg("--limit", 20000);
  const output = resolve(process.cwd(), parseStringArg("--output", DEFAULT_OUTPUT));

  const report = await buildRuntimeRolloutDashboardReport({
    windowDays,
    limit,
  });

  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ ok: true, output, windowDays, limit }));
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exit(1);
});

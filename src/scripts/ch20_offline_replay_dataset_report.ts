import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { prisma } from "../lib/db";
import { buildReplayDatasetCompletenessArtifact } from "../lib/quality/replayDatasetCompleteness";
import { serializeOfflineReplayDatasetRows } from "../lib/replay/offlineDataset";

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
  const eventLimit = Math.max(500, Math.min(200000, Math.floor(parseNumberFlag(argv, "--event-limit") ?? 50000)));
  const decisionLimit = Math.max(100, Math.min(50000, Math.floor(parseNumberFlag(argv, "--decision-limit") ?? 5000)));
  const sampleLimit = Math.max(1, Math.min(200, Math.floor(parseNumberFlag(argv, "--sample-limit") ?? 20)));

  const datasetFormatRaw = (parseStringFlag(argv, "--dataset-format") || "ndjson").toLowerCase();
  const datasetFormat = datasetFormatRaw === "json" ? "json" : "ndjson";

  const datasetOutputPath =
    parseStringFlag(argv, "--dataset-output") ||
    "docs/reports/CH20_OFFLINE_REPLAY_DATASET.ndjson";
  const reportOutputPath =
    parseStringFlag(argv, "--report-output") ||
    "docs/reports/CH20_OFFLINE_REPLAY_DATASET_REPORT.json";

  const { dataset, report } = await buildReplayDatasetCompletenessArtifact({
    windowDays,
    eventLimit,
    decisionLimit,
    sampleLimit,
  });

  const resolvedDatasetPath = resolve(datasetOutputPath);
  const resolvedReportPath = resolve(reportOutputPath);

  mkdirSync(dirname(resolvedDatasetPath), { recursive: true });
  mkdirSync(dirname(resolvedReportPath), { recursive: true });

  const datasetPayload = serializeOfflineReplayDatasetRows(dataset.rows, datasetFormat);
  writeFileSync(resolvedDatasetPath, datasetPayload, "utf8");
  writeFileSync(resolvedReportPath, JSON.stringify(report, null, 2), "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        datasetVersion: dataset.datasetVersion,
        windowDays,
        eventLimit,
        decisionLimit,
        sampleLimit,
        datasetFormat,
        datasetRows: dataset.rows.length,
        reportSummary: report.summary,
        datasetOutputPath: resolvedDatasetPath,
        reportOutputPath: resolvedReportPath,
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

import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { causalCoreLabels } from "../lib/db/types";
import { prisma } from "../lib/db";

type Options = {
  days: number;
  limit: number;
  outputPath: string | null;
};

function parseIntFlag(args: string[], flag: string, fallback: number) {
  const index = args.findIndex((arg) => arg === flag);
  if (index < 0) return fallback;
  const raw = Number(args[index + 1]);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.floor(raw);
}

function parseStringFlag(args: string[], flag: string) {
  const index = args.findIndex((arg) => arg === flag);
  if (index < 0) return null;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) return null;
  return value;
}

function parseOptions(args: string[]): Options {
  return {
    days: parseIntFlag(args, "--days", 30),
    limit: parseIntFlag(args, "--limit", 5000),
    outputPath: parseStringFlag(args, "--output"),
  };
}

function round(value: number, digits = 4) {
  return Number(value.toFixed(digits));
}

function intervalWidth(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const lower = typeof row.lower === "number" ? row.lower : null;
  const upper = typeof row.upper === "number" ? row.upper : null;
  if (lower === null || upper === null) return null;
  return Math.max(0, upper - lower);
}

async function maybeWriteOutput(path: string | null, report: unknown) {
  if (!path) return;
  const resolved = resolve(process.cwd(), path);
  await mkdir(dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const fromTs = new Date(Date.now() - options.days * 24 * 60 * 60 * 1000);

  const diagnoses = await prisma.causalDiagnosis.findMany({
    where: { createdAt: { gte: fromTs } },
    orderBy: { createdAt: "desc" },
    take: options.limit,
    select: {
      id: true,
      attemptId: true,
      studentId: true,
      taxonomyVersion: true,
      modelVersion: true,
      topLabel: true,
      topProbability: true,
      entropy: true,
      topMargin: true,
      confidenceIntervalJson: true,
      distributionJson: true,
      createdAt: true,
    },
  });

  const labelCounts = Object.fromEntries(causalCoreLabels.map((label) => [label, 0])) as Record<string, number>;
  let entropySum = 0;
  let entropyCount = 0;
  let marginSum = 0;
  let marginCount = 0;
  let intervalSum = 0;
  let intervalCount = 0;
  let wideIntervalCount = 0;

  for (const row of diagnoses) {
    const label = causalCoreLabels.includes(row.topLabel as (typeof causalCoreLabels)[number])
      ? row.topLabel
      : "unknown";
    labelCounts[label] += 1;

    if (typeof row.entropy === "number") {
      entropySum += row.entropy;
      entropyCount += 1;
    }
    if (typeof row.topMargin === "number") {
      marginSum += row.topMargin;
      marginCount += 1;
    }

    const width = intervalWidth(row.confidenceIntervalJson);
    if (width !== null) {
      intervalSum += width;
      intervalCount += 1;
      if (width > 0.4) wideIntervalCount += 1;
    }
  }

  const sampleSize = diagnoses.length;
  const topLabelRates = Object.fromEntries(
    Object.entries(labelCounts).map(([label, count]) => [label, sampleSize > 0 ? round(count / sampleSize) : 0])
  );

  const report = {
    generatedAt: new Date().toISOString(),
    window: {
      days: options.days,
      from: fromTs.toISOString(),
    },
    sampleSize,
    taxonomyVersions: [...new Set(diagnoses.map((row) => row.taxonomyVersion))],
    modelVersions: [...new Set(diagnoses.map((row) => row.modelVersion))],
    summary: {
      avgTopProbability:
        sampleSize > 0
          ? round(diagnoses.reduce((sum, row) => sum + row.topProbability, 0) / sampleSize)
          : null,
      avgEntropy: entropyCount > 0 ? round(entropySum / entropyCount) : null,
      avgTopMargin: marginCount > 0 ? round(marginSum / marginCount) : null,
      avgConfidenceIntervalWidth: intervalCount > 0 ? round(intervalSum / intervalCount) : null,
      wideConfidenceIntervalRate: intervalCount > 0 ? round(wideIntervalCount / intervalCount) : null,
      unknownTopRate: topLabelRates.unknown || 0,
      mixedTopRate: topLabelRates.mixed || 0,
    },
    distribution: {
      topLabelCounts: labelCounts,
      topLabelRates,
    },
    recentSamples: diagnoses.slice(0, 20).map((row) => ({
      id: row.id,
      attemptId: row.attemptId,
      studentId: row.studentId,
      topLabel: row.topLabel,
      topProbability: row.topProbability,
      entropy: row.entropy,
      topMargin: row.topMargin,
      confidenceIntervalJson: row.confidenceIntervalJson,
      distributionJson: row.distributionJson,
      createdAt: row.createdAt,
    })),
  };

  await maybeWriteOutput(options.outputPath, report);
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ch08:causal-calibration] ${message}`);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

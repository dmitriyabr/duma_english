import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildOffPolicyEvaluationReport } from "../lib/ope/offPolicyEvaluation";
import { prisma } from "../lib/db";

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
  const windowDays = Math.max(1, Math.min(365, Math.floor(parseNumberFlag(argv, "--window-days") ?? 90)));
  const limit = Math.max(10, Math.min(100000, Math.floor(parseNumberFlag(argv, "--limit") ?? 10000)));
  const bootstrapSamples = Math.max(0, Math.min(2000, Math.floor(parseNumberFlag(argv, "--bootstrap-samples") ?? 400)));
  const maxIncompleteRate = Math.max(0, Math.min(1, parseNumberFlag(argv, "--max-incomplete-rate") ?? 1));
  const minCompleteSamples = Math.max(0, Math.floor(parseNumberFlag(argv, "--min-complete-samples") ?? 0));
  const minCiLowerBound = parseNumberFlag(argv, "--min-ci-lower-bound");
  const maxCiWidth = parseNumberFlag(argv, "--max-ci-width");
  const outputPath = parseStringFlag(argv, "--output");

  const report = await buildOffPolicyEvaluationReport({
    windowDays,
    limit,
    bootstrapSamples,
  });

  if (outputPath) {
    const resolvedPath = resolve(outputPath);
    mkdirSync(dirname(resolvedPath), { recursive: true });
    writeFileSync(resolvedPath, JSON.stringify(report, null, 2), "utf8");
  }

  console.log(JSON.stringify({ ok: true, ...report }, null, 2));

  if (report.completeRows < minCompleteSamples) {
    console.error(
      `[ch21] completeRows ${report.completeRows} below min ${minCompleteSamples}`
    );
    process.exitCode = 1;
  }

  if (report.incompleteRate > maxIncompleteRate) {
    console.error(
      `[ch21] incompleteRate ${report.incompleteRate.toFixed(4)} exceeds max ${maxIncompleteRate.toFixed(4)}`
    );
    process.exitCode = 1;
  }

  if (minCiLowerBound !== null) {
    if (report.metrics.ciLower === null || report.metrics.ciLower < minCiLowerBound) {
      console.error(
        `[ch21] ciLower ${report.metrics.ciLower} is below required min ${minCiLowerBound}`
      );
      process.exitCode = 1;
    }
  }

  if (maxCiWidth !== null) {
    if (report.metrics.ciLower === null || report.metrics.ciUpper === null) {
      console.error("[ch21] cannot check ci width: confidence bounds are missing");
      process.exitCode = 1;
    } else {
      const width = report.metrics.ciUpper - report.metrics.ciLower;
      if (width > maxCiWidth) {
        console.error(`[ch21] ci width ${width.toFixed(6)} exceeds max ${maxCiWidth.toFixed(6)}`);
        process.exitCode = 1;
      }
    }
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

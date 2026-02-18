import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { causalCoreLabels, normalizeCausalLabel } from "../lib/db/types";
import { prisma } from "../lib/db";

type Options = {
  days: number;
  limit: number;
  outputPath: string | null;
};

type DistributionSummary = {
  valid: boolean;
  topLabel: string | null;
  mass: number | null;
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
    limit: parseIntFlag(args, "--limit", 4000),
    outputPath: parseStringFlag(args, "--output"),
  };
}

function round(value: number, digits = 4) {
  return Number(value.toFixed(digits));
}

function hasText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function toRate(numerator: number, denominator: number) {
  if (denominator <= 0) return 0;
  return round(numerator / denominator);
}

function readDistributionSummary(value: unknown): DistributionSummary {
  if (!Array.isArray(value) || value.length === 0) {
    return { valid: false, topLabel: null, mass: null };
  }

  let mass = 0;
  let topLabel: string | null = null;
  let topProb = -1;
  for (const item of value) {
    if (!item || typeof item !== "object") {
      return { valid: false, topLabel: null, mass: null };
    }
    const row = item as Record<string, unknown>;
    const probability = typeof row.p === "number" ? row.p : null;
    if (probability === null || !Number.isFinite(probability) || probability < 0 || probability > 1) {
      return { valid: false, topLabel: null, mass: null };
    }
    const label = normalizeCausalLabel(typeof row.label === "string" ? row.label : "unknown");
    mass += probability;
    if (probability > topProb) {
      topProb = probability;
      topLabel = label;
    }
  }

  return {
    valid: true,
    topLabel,
    mass: round(mass),
  };
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
      attemptId: true,
      studentId: true,
      topLabel: true,
      modelVersion: true,
      createdAt: true,
    },
  });

  const diagnosisMap = new Map(
    diagnoses.map((row) => [row.attemptId, { topLabel: normalizeCausalLabel(row.topLabel), modelVersion: row.modelVersion }])
  );
  const diagnosisAttemptIds = diagnoses.map((row) => row.attemptId);
  const diagnosisStudentIds = Array.from(new Set(diagnoses.map((row) => row.studentId)));

  const [evidenceRows, masteryRows] = await Promise.all([
    diagnosisAttemptIds.length === 0
      ? Promise.resolve([])
      : prisma.attemptGseEvidence.findMany({
          where: { attemptId: { in: diagnosisAttemptIds } },
          select: {
            attemptId: true,
            causeTopLabel: true,
            causeTopProbability: true,
            causeDistributionJson: true,
            causeModelVersion: true,
          },
        }),
    diagnosisStudentIds.length === 0
      ? Promise.resolve([])
      : prisma.studentGseMastery.findMany({
          where: {
            studentId: { in: diagnosisStudentIds },
            updatedAt: { gte: fromTs },
          },
          select: {
            studentId: true,
            nodeId: true,
            dominantCauseLabel: true,
            dominantCauseProbability: true,
            dominantCauseDistributionJson: true,
            dominantCauseModelVersion: true,
            updatedAt: true,
          },
          take: Math.max(4000, options.limit * 8),
          orderBy: { updatedAt: "desc" },
        }),
  ]);

  const evidenceByAttempt = new Map<string, typeof evidenceRows>();
  for (const row of evidenceRows) {
    const list = evidenceByAttempt.get(row.attemptId) ?? [];
    list.push(row);
    evidenceByAttempt.set(row.attemptId, list);
  }

  const evidenceTopLabelCounts = Object.fromEntries(causalCoreLabels.map((label) => [label, 0])) as Record<string, number>;
  let evidenceRowsWithCompleteAttribution = 0;
  let evidenceMissingLabelRows = 0;
  let evidenceMissingDistributionRows = 0;
  let evidenceMissingModelVersionRows = 0;
  let evidenceInvalidProbabilityRows = 0;
  let evidenceInvalidDistributionRows = 0;
  let evidenceDistributionTopMismatchRows = 0;
  let evidenceDistributionMassDriftRows = 0;
  let evidenceLabelMismatchRows = 0;
  let evidenceModelVersionMismatchRows = 0;

  for (const row of evidenceRows) {
    const diagnosis = diagnosisMap.get(row.attemptId);
    const hasLabel = hasText(row.causeTopLabel);
    const hasDistribution = row.causeDistributionJson !== null;
    const hasModelVersion = hasText(row.causeModelVersion);

    if (!hasLabel) evidenceMissingLabelRows += 1;
    if (!hasDistribution) evidenceMissingDistributionRows += 1;
    if (!hasModelVersion) evidenceMissingModelVersionRows += 1;
    if (hasLabel && hasDistribution && hasModelVersion) evidenceRowsWithCompleteAttribution += 1;

    if (typeof row.causeTopProbability === "number") {
      if (row.causeTopProbability < 0 || row.causeTopProbability > 1) evidenceInvalidProbabilityRows += 1;
    }

    if (hasLabel) {
      const normalized = normalizeCausalLabel(row.causeTopLabel);
      evidenceTopLabelCounts[normalized] += 1;
      if (diagnosis && normalized !== diagnosis.topLabel) evidenceLabelMismatchRows += 1;
    }

    if (hasModelVersion && diagnosis && row.causeModelVersion !== diagnosis.modelVersion) {
      evidenceModelVersionMismatchRows += 1;
    }

    if (hasDistribution) {
      const summary = readDistributionSummary(row.causeDistributionJson);
      if (!summary.valid) {
        evidenceInvalidDistributionRows += 1;
      } else {
        if (typeof summary.mass === "number" && Math.abs(summary.mass - 1) > 0.02) {
          evidenceDistributionMassDriftRows += 1;
        }
        if (hasLabel && summary.topLabel && summary.topLabel !== normalizeCausalLabel(row.causeTopLabel)) {
          evidenceDistributionTopMismatchRows += 1;
        }
      }
    }
  }

  let attemptsWithEvidenceRows = 0;
  let attemptsFullyAttributed = 0;
  let attemptsPartiallyAttributed = 0;
  let attemptsWithoutEvidenceRows = 0;
  const attemptCoverageSamples: Array<{
    attemptId: string;
    evidenceRows: number;
    completeRows: number;
    diagnosisTopLabel: string;
    diagnosisModelVersion: string;
  }> = [];

  for (const diagnosis of diagnoses) {
    const rows = evidenceByAttempt.get(diagnosis.attemptId) ?? [];
    if (rows.length === 0) {
      attemptsWithoutEvidenceRows += 1;
      continue;
    }
    attemptsWithEvidenceRows += 1;

    let completeRows = 0;
    for (const row of rows) {
      const complete = hasText(row.causeTopLabel) && row.causeDistributionJson !== null && hasText(row.causeModelVersion);
      if (complete) completeRows += 1;
    }

    if (completeRows === rows.length) {
      attemptsFullyAttributed += 1;
    } else {
      attemptsPartiallyAttributed += 1;
      if (attemptCoverageSamples.length < 25) {
        attemptCoverageSamples.push({
          attemptId: diagnosis.attemptId,
          evidenceRows: rows.length,
          completeRows,
          diagnosisTopLabel: normalizeCausalLabel(diagnosis.topLabel),
          diagnosisModelVersion: diagnosis.modelVersion,
        });
      }
    }
  }

  const masteryTopLabelCounts = Object.fromEntries(causalCoreLabels.map((label) => [label, 0])) as Record<string, number>;
  let masteryRowsWithAnyCauseField = 0;
  let masteryRowsWithCompleteAttribution = 0;
  let masteryMissingLabelRows = 0;
  let masteryMissingDistributionRows = 0;
  let masteryMissingModelVersionRows = 0;
  let masteryInvalidProbabilityRows = 0;
  let masteryInvalidDistributionRows = 0;
  let masteryDistributionTopMismatchRows = 0;
  let masteryDistributionMassDriftRows = 0;

  for (const row of masteryRows) {
    const hasLabel = hasText(row.dominantCauseLabel);
    const hasDistribution = row.dominantCauseDistributionJson !== null;
    const hasModelVersion = hasText(row.dominantCauseModelVersion);

    if (hasLabel || hasDistribution || hasModelVersion) {
      masteryRowsWithAnyCauseField += 1;
      if (!hasLabel) masteryMissingLabelRows += 1;
      if (!hasDistribution) masteryMissingDistributionRows += 1;
      if (!hasModelVersion) masteryMissingModelVersionRows += 1;
      if (hasLabel && hasDistribution && hasModelVersion) masteryRowsWithCompleteAttribution += 1;
    }

    if (hasLabel) {
      const normalized = normalizeCausalLabel(row.dominantCauseLabel);
      masteryTopLabelCounts[normalized] += 1;
    }

    if (typeof row.dominantCauseProbability === "number") {
      if (row.dominantCauseProbability < 0 || row.dominantCauseProbability > 1) masteryInvalidProbabilityRows += 1;
    }

    if (hasDistribution) {
      const summary = readDistributionSummary(row.dominantCauseDistributionJson);
      if (!summary.valid) {
        masteryInvalidDistributionRows += 1;
      } else {
        if (typeof summary.mass === "number" && Math.abs(summary.mass - 1) > 0.02) {
          masteryDistributionMassDriftRows += 1;
        }
        if (hasLabel && summary.topLabel && summary.topLabel !== normalizeCausalLabel(row.dominantCauseLabel)) {
          masteryDistributionTopMismatchRows += 1;
        }
      }
    }
  }

  const diagnosisModelVersions = Array.from(new Set(diagnoses.map((row) => row.modelVersion)));
  const diagnosisTopLabelCounts = Object.fromEntries(causalCoreLabels.map((label) => [label, 0])) as Record<string, number>;
  for (const row of diagnoses) {
    diagnosisTopLabelCounts[normalizeCausalLabel(row.topLabel)] += 1;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    window: {
      days: options.days,
      from: fromTs.toISOString(),
    },
    sampleSize: {
      diagnoses: diagnoses.length,
      attemptEvidenceRows: evidenceRows.length,
      masteryRows: masteryRows.length,
    },
    diagnosisSnapshot: {
      modelVersions: diagnosisModelVersions,
      topLabelCounts: diagnosisTopLabelCounts,
      topLabelRates: Object.fromEntries(
        Object.entries(diagnosisTopLabelCounts).map(([label, count]) => [label, toRate(count, diagnoses.length)])
      ),
    },
    evidenceAudit: {
      attemptsWithDiagnosis: diagnoses.length,
      attemptsWithEvidenceRows,
      attemptsWithoutEvidenceRows,
      attemptsFullyAttributed,
      attemptsPartiallyAttributed,
      attemptFullAttributionRate: toRate(attemptsFullyAttributed, attemptsWithEvidenceRows),
      rowsTotal: evidenceRows.length,
      rowsWithCompleteAttribution: evidenceRowsWithCompleteAttribution,
      rowCompleteAttributionRate: toRate(evidenceRowsWithCompleteAttribution, evidenceRows.length),
      missingFieldCounts: {
        label: evidenceMissingLabelRows,
        distribution: evidenceMissingDistributionRows,
        modelVersion: evidenceMissingModelVersionRows,
      },
      contractViolations: {
        invalidProbabilityRows: evidenceInvalidProbabilityRows,
        invalidDistributionRows: evidenceInvalidDistributionRows,
        distributionTopMismatchRows: evidenceDistributionTopMismatchRows,
        distributionMassDriftRows: evidenceDistributionMassDriftRows,
        labelMismatchVsDiagnosisRows: evidenceLabelMismatchRows,
        modelVersionMismatchVsDiagnosisRows: evidenceModelVersionMismatchRows,
      },
      topLabelCounts: evidenceTopLabelCounts,
      topLabelRates: Object.fromEntries(
        Object.entries(evidenceTopLabelCounts).map(([label, count]) => [label, toRate(count, evidenceRows.length)])
      ),
      partialAttemptSamples: attemptCoverageSamples,
    },
    masteryAudit: {
      rowsScanned: masteryRows.length,
      rowsWithAnyCauseField: masteryRowsWithAnyCauseField,
      rowsWithCompleteAttribution: masteryRowsWithCompleteAttribution,
      completeAttributionRate: toRate(masteryRowsWithCompleteAttribution, masteryRowsWithAnyCauseField),
      missingFieldCounts: {
        label: masteryMissingLabelRows,
        distribution: masteryMissingDistributionRows,
        modelVersion: masteryMissingModelVersionRows,
      },
      contractViolations: {
        invalidProbabilityRows: masteryInvalidProbabilityRows,
        invalidDistributionRows: masteryInvalidDistributionRows,
        distributionTopMismatchRows: masteryDistributionTopMismatchRows,
        distributionMassDriftRows: masteryDistributionMassDriftRows,
      },
      topLabelCounts: masteryTopLabelCounts,
      topLabelRates: Object.fromEntries(
        Object.entries(masteryTopLabelCounts).map(([label, count]) => [label, toRate(count, masteryRowsWithAnyCauseField)])
      ),
    },
  };

  await maybeWriteOutput(options.outputPath, report);
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ch09:cause-attribution-audit] ${message}`);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

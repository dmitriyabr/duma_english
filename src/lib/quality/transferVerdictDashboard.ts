import { prisma } from "@/lib/db";
import {
  transferVerdictAuditReportSchema,
  type TransferVerdictAuditReport,
} from "@/lib/contracts/transferVerdictAudit";
import { TRANSFER_VERDICT_PROTOCOL_VERSION } from "@/lib/ood/transferVerdict";

const DAY_MS = 24 * 60 * 60 * 1000;

function asJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function readTransferVerdictMetadata(metadataJson: unknown) {
  const metadata = asJsonObject(metadataJson);
  const verdict = asJsonObject(metadata.transferVerdict);
  const oodOutcome = typeof verdict.oodOutcome === "string" ? verdict.oodOutcome : null;
  const matchedControlPass = verdict.matchedControlPass === true;
  const verdictValue = typeof verdict.verdict === "string" ? verdict.verdict : null;
  return {
    oodOutcome,
    matchedControlPass,
    verdictValue,
  };
}

export async function buildTransferVerdictDashboard(params?: {
  windowDays?: number;
  limit?: number;
}): Promise<TransferVerdictAuditReport> {
  const windowDays = Math.max(1, Math.min(365, Math.floor(params?.windowDays ?? 30)));
  const limit = Math.max(10, Math.min(50000, Math.floor(params?.limit ?? 5000)));
  const since = new Date(Date.now() - windowDays * DAY_MS);

  const rows = await prisma.oODTaskSpec.findMany({
    where: {
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      verdict: true,
      status: true,
      axisTags: true,
      metadataJson: true,
    },
  });

  let evaluatedOodSpecs = 0;
  let transferPassCount = 0;
  let candidateTransferFailCount = 0;
  let validatedTransferFailCount = 0;
  let unvalidatedTransferFailCount = 0;
  let inconclusiveCount = 0;
  let protocolViolationCount = 0;

  const verdictCounts = new Map<string, number>();
  const axisCounts = new Map<string, number>();

  for (const row of rows) {
    for (const axis of row.axisTags || []) {
      axisCounts.set(axis, (axisCounts.get(axis) || 0) + 1);
    }

    const normalizedVerdict =
      typeof row.verdict === "string" && row.verdict.trim().length > 0
        ? row.verdict.trim()
        : row.status === "evaluated"
          ? "evaluated_without_verdict"
          : "pending";
    verdictCounts.set(normalizedVerdict, (verdictCounts.get(normalizedVerdict) || 0) + 1);

    const metadata = readTransferVerdictMetadata(row.metadataJson);
    const oodOutcome = metadata.oodOutcome;
    const matchedControlPass = metadata.matchedControlPass;

    if (normalizedVerdict !== "pending") {
      evaluatedOodSpecs += 1;
    }

    if (normalizedVerdict === "transfer_pass") {
      transferPassCount += 1;
    }

    const candidateFail =
      normalizedVerdict === "transfer_fail_validated" ||
      normalizedVerdict === "inconclusive_control_missing" ||
      oodOutcome === "candidate_fail";

    if (candidateFail) {
      candidateTransferFailCount += 1;
      if (matchedControlPass) {
        validatedTransferFailCount += 1;
      } else {
        unvalidatedTransferFailCount += 1;
      }
    }

    if (normalizedVerdict.startsWith("inconclusive") || normalizedVerdict === "evaluated_without_verdict") {
      inconclusiveCount += 1;
    }

    if (normalizedVerdict === "transfer_fail_validated" && !matchedControlPass) {
      protocolViolationCount += 1;
    }
  }

  const pendingOodSpecs = Math.max(0, rows.length - evaluatedOodSpecs);
  const report = {
    generatedAt: new Date().toISOString(),
    protocolVersion: TRANSFER_VERDICT_PROTOCOL_VERSION,
    windowDays,
    totalOodSpecs: rows.length,
    evaluatedOodSpecs,
    pendingOodSpecs,
    transferPassCount,
    candidateTransferFailCount,
    validatedTransferFailCount,
    unvalidatedTransferFailCount,
    inconclusiveCount,
    protocolViolationCount,
    matchedControlPassRate:
      candidateTransferFailCount > 0 ? Number((validatedTransferFailCount / candidateTransferFailCount).toFixed(6)) : null,
    verdictBreakdown: [...verdictCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([verdict, count]) => ({ verdict, count })),
    axisBreakdown: [...axisCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([axisTag, count]) => ({ axisTag, count })),
  };

  return transferVerdictAuditReportSchema.parse(report);
}

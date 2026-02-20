import type { PlaybookTrigger, PlaybookTriggerContext, RunbookId } from "@/lib/contracts/operationalPlaybooks";

const RETRY_LOOP_LOOKBACK = 5;
const RETRY_LOOP_MIN_RETRIES = 3;

const CAUSE_PLATEAU_LOOKBACK = 5;
const CAUSE_PLATEAU_MIN_SAME = 4;

const WEAK_TRANSFER_INDOMAIN_MIN_ATTEMPTS = 5;
const WEAK_TRANSFER_INDOMAIN_PASS_THRESHOLD = 0.7;
const WEAK_TRANSFER_OOD_MIN_EVALUABLE = 3;
const WEAK_TRANSFER_MAX_PASS_RATE = 0.4;

const FAST_PROGRESS_RELIABILITY_MIN_STAGE_INDEX = 2; // B1+ (A0=0, A1=1, A2=2, B1=3...)
const STAGE_ORDER = ["A0", "A1", "A2", "B1", "B2", "C1", "C2"];
const RELIABILITY_GATE = 0.65;

function stageIndex(stage: string): number {
  const i = STAGE_ORDER.indexOf(stage);
  return i === -1 ? 0 : i;
}

export type RetryLoopRow = { studentId: string; status: string; createdAt: Date };
export function evaluateRetryLoopTrigger(rows: RetryLoopRow[], now: Date): PlaybookTrigger | null {
  const sorted = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const last = sorted.slice(0, RETRY_LOOP_LOOKBACK);
  const retryCount = last.filter((r) => r.status === "NEEDS_RETRY").length;
  if (retryCount < RETRY_LOOP_MIN_RETRIES || last.length < RETRY_LOOP_LOOKBACK) return null;
  const studentId = rows[0]?.studentId;
  if (!studentId) return null;
  return {
    runbookId: "retry_loop",
    studentId,
    triggeredAt: now.toISOString(),
    context: {
      reason: `${retryCount} NEEDS_RETRY in last ${RETRY_LOOP_LOOKBACK} attempts`,
      count: retryCount,
      window: `last ${RETRY_LOOP_LOOKBACK} attempts`,
    },
  };
}

export type CausePlateauRow = { studentId: string; topLabel: string; createdAt: Date };
export function evaluateCausePlateauTrigger(rows: CausePlateauRow[], now: Date): PlaybookTrigger | null {
  const sorted = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const last = sorted.slice(0, CAUSE_PLATEAU_LOOKBACK);
  if (last.length < CAUSE_PLATEAU_LOOKBACK) return null;
  const topLabelCount = new Map<string, number>();
  for (const r of last) {
    topLabelCount.set(r.topLabel, (topLabelCount.get(r.topLabel) ?? 0) + 1);
  }
  const [dominantLabel, count] = [...topLabelCount.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
  if (!dominantLabel || (count ?? 0) < CAUSE_PLATEAU_MIN_SAME) return null;
  const studentId = rows[0]?.studentId;
  if (!studentId) return null;
  return {
    runbookId: "cause_plateau",
    studentId,
    triggeredAt: now.toISOString(),
    context: {
      reason: `Same cause "${dominantLabel}" in ${count} of last ${CAUSE_PLATEAU_LOOKBACK} diagnoses`,
      count: count ?? 0,
      window: `last ${CAUSE_PLATEAU_LOOKBACK} diagnoses`,
    },
  };
}

export type WeakTransferRow = {
  studentId: string;
  inDomainPassCount: number;
  inDomainTotal: number;
  oodPassCount: number;
  oodEvaluable: number;
};
export function evaluateWeakTransferTrigger(row: WeakTransferRow, now: Date): PlaybookTrigger | null {
  if (row.inDomainTotal < WEAK_TRANSFER_INDOMAIN_MIN_ATTEMPTS) return null;
  const inDomainRate = row.inDomainPassCount / row.inDomainTotal;
  if (inDomainRate < WEAK_TRANSFER_INDOMAIN_PASS_THRESHOLD) return null;
  if (row.oodEvaluable < WEAK_TRANSFER_OOD_MIN_EVALUABLE) return null;
  const oodRate = row.oodPassCount / row.oodEvaluable;
  if (oodRate > WEAK_TRANSFER_MAX_PASS_RATE) return null;
  return {
    runbookId: "weak_transfer_high_indomain",
    studentId: row.studentId,
    triggeredAt: now.toISOString(),
    context: {
      reason: `High in-domain pass rate (${(inDomainRate * 100).toFixed(0)}%) but low transfer (${(oodRate * 100).toFixed(0)}% over ${row.oodEvaluable} OOD tasks)`,
      count: row.oodEvaluable,
      window: "recent",
    },
  };
}

export type FastProgressLowReliabilityRow = {
  studentId: string;
  placementStage: string;
  targetStageStatsReliabilityRatio: number | null;
};
export function evaluateFastProgressLowReliabilityTrigger(
  row: FastProgressLowReliabilityRow,
  now: Date
): PlaybookTrigger | null {
  if (stageIndex(row.placementStage) < FAST_PROGRESS_RELIABILITY_MIN_STAGE_INDEX) return null;
  const rel = row.targetStageStatsReliabilityRatio ?? 0;
  if (rel >= RELIABILITY_GATE) return null;
  return {
    runbookId: "fast_progress_low_reliability",
    studentId: row.studentId,
    triggeredAt: now.toISOString(),
    context: {
      reason: `Placement ${row.placementStage} but target-stage reliability ${(rel * 100).toFixed(0)}% below gate ${RELIABILITY_GATE * 100}%`,
      window: "current",
    },
  };
}

export function runbookIdToSummaryKey(id: RunbookId): keyof {
  retry_loop: number;
  cause_plateau: number;
  weak_transfer_high_indomain: number;
  fast_progress_low_reliability: number;
  total: number;
} {
  return id;
}

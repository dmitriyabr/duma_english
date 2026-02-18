import type { CEFRStage } from "@/lib/curriculum";
import { prisma } from "@/lib/db";
import {
  computeRetentionPassRateMetric,
  type KpiRetentionEvidenceRow,
} from "@/lib/kpi/autopilotDashboard";

const DAY_MS = 24 * 60 * 60 * 1000;
const STAGE_ORDER: CEFRStage[] = ["A0", "A1", "A2", "B1", "B2", "C1", "C2"];

export const RETENTION_PROMOTION_GATE_VERSION = "retention-promotion-gate-v1" as const;
export const RETENTION_PROMOTION_PASS_THRESHOLD = 0.7;
export const RETENTION_PROMOTION_WINDOWS = [7, 30, 90] as const;
export const RETENTION_PROMOTION_LOOKBACK_DAYS = 365;

const HIGH_STAKES_STAGE: CEFRStage = "B1";

const MIN_SAMPLES_BY_WINDOW: Record<(typeof RETENTION_PROMOTION_WINDOWS)[number], number> = {
  7: 3,
  30: 2,
  90: 1,
};

export type RetentionGateStatus = "pass" | "fail" | "insufficient_sample";

export type RetentionPromotionGateWindowResult = {
  windowDays: (typeof RETENTION_PROMOTION_WINDOWS)[number];
  value: number | null;
  sampleSize: number;
  minSampleSize: number;
  status: RetentionGateStatus;
  passed: boolean;
};

export type RetentionPromotionGateResult = {
  protocolVersion: typeof RETENTION_PROMOTION_GATE_VERSION;
  required: boolean;
  highStakesTarget: boolean;
  passThreshold: number;
  windows: RetentionPromotionGateWindowResult[];
  passed: boolean;
  blockerReasons: string[];
};

function stageIndex(stage: CEFRStage) {
  const idx = STAGE_ORDER.indexOf(stage);
  return idx === -1 ? 0 : idx;
}

function isHighStakesTargetStage(stage: CEFRStage) {
  return stageIndex(stage) >= stageIndex(HIGH_STAKES_STAGE);
}

function evaluateWindow(
  rows: KpiRetentionEvidenceRow[],
  windowDays: (typeof RETENTION_PROMOTION_WINDOWS)[number],
  now: Date,
): RetentionPromotionGateWindowResult {
  const metric = computeRetentionPassRateMetric({
    rows,
    retentionWindowDays: windowDays,
    now,
  });

  const minSampleSize = MIN_SAMPLES_BY_WINDOW[windowDays];
  const sampleSize = metric.sampleSize;
  const value = metric.value;

  let status: RetentionGateStatus;
  if (sampleSize < minSampleSize) {
    status = "insufficient_sample";
  } else if (value === null || value < RETENTION_PROMOTION_PASS_THRESHOLD) {
    status = "fail";
  } else {
    status = "pass";
  }

  return {
    windowDays,
    value,
    sampleSize,
    minSampleSize,
    status,
    passed: status === "pass",
  };
}

function blockerReasonFromWindow(window: RetentionPromotionGateWindowResult) {
  if (window.status === "insufficient_sample") {
    return `retention_${window.windowDays}d_insufficient_sample`;
  }
  return `retention_${window.windowDays}d_below_threshold`;
}

export function evaluateRetentionPromotionGateFromRows(params: {
  rows: KpiRetentionEvidenceRow[];
  targetStage: CEFRStage;
  now?: Date;
}): RetentionPromotionGateResult {
  const now = params.now || new Date();
  const highStakesTarget = isHighStakesTargetStage(params.targetStage);
  const required = highStakesTarget;

  const windows = RETENTION_PROMOTION_WINDOWS.map((windowDays) =>
    evaluateWindow(params.rows, windowDays, now),
  );

  const blockerReasons = required
    ? windows.filter((window) => !window.passed).map(blockerReasonFromWindow)
    : [];

  return {
    protocolVersion: RETENTION_PROMOTION_GATE_VERSION,
    required,
    highStakesTarget,
    passThreshold: RETENTION_PROMOTION_PASS_THRESHOLD,
    windows,
    passed: required ? blockerReasons.length === 0 : true,
    blockerReasons,
  };
}

export async function evaluateRetentionPromotionGate(params: {
  studentId: string;
  targetStage: CEFRStage;
  now?: Date;
}): Promise<RetentionPromotionGateResult> {
  const now = params.now || new Date();
  const retentionFrom = new Date(
    now.getTime() - RETENTION_PROMOTION_LOOKBACK_DAYS * DAY_MS,
  );

  const rows = await prisma.attemptGseEvidence.findMany({
    where: {
      studentId: params.studentId,
      evidenceKind: "direct",
      createdAt: { gte: retentionFrom },
    },
    select: {
      studentId: true,
      nodeId: true,
      createdAt: true,
      score: true,
    },
    orderBy: [{ nodeId: "asc" }, { createdAt: "asc" }],
  });

  return evaluateRetentionPromotionGateFromRows({
    rows,
    targetStage: params.targetStage,
    now,
  });
}

export const __internal = {
  stageIndex,
  isHighStakesTargetStage,
  blockerReasonFromWindow,
};

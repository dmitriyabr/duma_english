import { CEFRStage } from "@/lib/curriculum";

const DAY_MS = 24 * 60 * 60 * 1000;

export const RETENTION_PROBE_PROTOCOL_VERSION = "retention-probes-v1" as const;
export const RETENTION_PROBE_WINDOWS = [7, 30, 90] as const;
export const RETENTION_PROBE_GRACE_DAYS = 21 as const;
export const RETENTION_PROBE_PASS_SCORE = 0.7 as const;

const WINDOW_WEIGHTS: Record<RetentionWindowDays, number> = {
  7: 0.35,
  30: 0.4,
  90: 0.25,
};

export type RetentionWindowDays = (typeof RETENTION_PROBE_WINDOWS)[number];
export type RetentionDomain = "vocab" | "grammar" | "communication" | "other";

export type RetentionEvidenceObservation = {
  studentId: string;
  nodeId: string;
  createdAt: Date;
  score: number;
  stage: CEFRStage;
  domain: RetentionDomain;
};

export type RetentionProbeStatus =
  | "passed"
  | "failed"
  | "missed_follow_up"
  | "pending_follow_up";

export type RetentionProbe = {
  studentId: string;
  nodeId: string;
  stage: CEFRStage;
  domain: RetentionDomain;
  windowDays: RetentionWindowDays;
  anchorAt: Date;
  dueAt: Date;
  windowEndAt: Date;
  anchorScore: number;
  followUpAt: Date | null;
  followUpScore: number | null;
  status: RetentionProbeStatus;
};

export type RetentionProbeWindowSummary = {
  windowDays: RetentionWindowDays;
  dueProbeCount: number;
  pendingProbeCount: number;
  evaluatedProbeCount: number;
  passedCount: number;
  failedCount: number;
  missedFollowUpCount: number;
  passRate: number | null;
  completionRate: number | null;
  medianFollowUpLagDays: number | null;
};

export type RetentionConfidenceSummary = {
  protocolVersion: typeof RETENTION_PROBE_PROTOCOL_VERSION;
  baseConfidence: number;
  adjustedConfidence: number;
  confidenceAdjustment: number;
  totalDueProbeCount: number;
  totalEvaluatedProbeCount: number;
  totalPassedCount: number;
  totalFailedCount: number;
  totalMissedFollowUpCount: number;
  blendedPassRate: number | null;
  blendedCompletionRate: number | null;
  windows: RetentionProbeWindowSummary[];
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits = 6) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function median(values: number[]) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return round(sorted[middle]!, 4);
  return round((sorted[middle - 1]! + sorted[middle]!) / 2, 4);
}

function normalizeString(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

export function mapRetentionDomain(params: {
  domain?: string | null;
  nodeType?: string | null;
  nodeSkill?: string | null;
}): RetentionDomain {
  const domain = normalizeString(params.domain);
  if (domain.includes("vocab")) return "vocab";
  if (domain.includes("grammar")) return "grammar";
  if (
    domain.includes("communication") ||
    domain.includes("speaking") ||
    domain.includes("listening") ||
    domain.includes("writing") ||
    domain.includes("lo")
  ) {
    return "communication";
  }

  const nodeType = normalizeString(params.nodeType);
  if (nodeType === "gse_vocab") return "vocab";
  if (nodeType === "gse_grammar") return "grammar";

  const nodeSkill = normalizeString(params.nodeSkill);
  if (nodeSkill === "vocabulary") return "vocab";
  if (nodeSkill === "grammar") return "grammar";
  if (nodeSkill === "speaking" || nodeSkill === "listening" || nodeSkill === "writing") {
    return "communication";
  }

  return "other";
}

export function mapRetentionStage(gseCenter: number | null | undefined): CEFRStage {
  if (typeof gseCenter !== "number" || !Number.isFinite(gseCenter)) return "A0";
  if (gseCenter <= 29) return "A1";
  if (gseCenter <= 42) return "A2";
  if (gseCenter <= 58) return "B1";
  if (gseCenter <= 75) return "B2";
  if (gseCenter <= 84) return "C1";
  return "C2";
}

export function buildRetentionProbes(params: {
  rows: RetentionEvidenceObservation[];
  now?: Date;
  windows?: readonly RetentionWindowDays[];
  passScore?: number;
  graceDays?: number;
}): RetentionProbe[] {
  const now = params.now || new Date();
  const windows = params.windows || RETENTION_PROBE_WINDOWS;
  const passScore = params.passScore ?? RETENTION_PROBE_PASS_SCORE;
  const graceDays = params.graceDays ?? RETENTION_PROBE_GRACE_DAYS;

  const grouped = new Map<string, RetentionEvidenceObservation[]>();
  for (const row of params.rows) {
    const key = `${row.studentId}:${row.nodeId}`;
    const current = grouped.get(key);
    if (current) {
      current.push(row);
    } else {
      grouped.set(key, [row]);
    }
  }

  const probes: RetentionProbe[] = [];

  for (const events of grouped.values()) {
    events.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    for (let i = 0; i < events.length; i += 1) {
      const anchor = events[i];
      if (anchor.score < passScore) continue;

      for (const windowDays of windows) {
        const dueAt = new Date(anchor.createdAt.getTime() + windowDays * DAY_MS);
        if (dueAt > now) continue;

        const windowEndAt = new Date(dueAt.getTime() + graceDays * DAY_MS);
        let followUp: RetentionEvidenceObservation | null = null;

        for (let j = i + 1; j < events.length; j += 1) {
          const candidate = events[j];
          const ts = candidate.createdAt.getTime();
          if (ts < dueAt.getTime()) continue;
          if (ts > windowEndAt.getTime()) break;
          followUp = candidate;
          break;
        }

        let status: RetentionProbeStatus;
        if (followUp) {
          status = followUp.score >= passScore ? "passed" : "failed";
        } else if (now > windowEndAt) {
          status = "missed_follow_up";
        } else {
          status = "pending_follow_up";
        }

        probes.push({
          studentId: anchor.studentId,
          nodeId: anchor.nodeId,
          stage: anchor.stage,
          domain: anchor.domain,
          windowDays,
          anchorAt: anchor.createdAt,
          dueAt,
          windowEndAt,
          anchorScore: anchor.score,
          followUpAt: followUp?.createdAt || null,
          followUpScore: followUp?.score ?? null,
          status,
        });
      }
    }
  }

  return probes;
}

export function summarizeRetentionProbesByWindow(params: {
  probes: RetentionProbe[];
  windows?: readonly RetentionWindowDays[];
}): RetentionProbeWindowSummary[] {
  const windows = params.windows || RETENTION_PROBE_WINDOWS;
  const byWindow = new Map<RetentionWindowDays, RetentionProbeWindowSummary>();
  const lagValues = new Map<RetentionWindowDays, number[]>();

  for (const windowDays of windows) {
    byWindow.set(windowDays, {
      windowDays,
      dueProbeCount: 0,
      pendingProbeCount: 0,
      evaluatedProbeCount: 0,
      passedCount: 0,
      failedCount: 0,
      missedFollowUpCount: 0,
      passRate: null,
      completionRate: null,
      medianFollowUpLagDays: null,
    });
    lagValues.set(windowDays, []);
  }

  for (const probe of params.probes) {
    const summary = byWindow.get(probe.windowDays);
    if (!summary) continue;

    summary.dueProbeCount += 1;

    if (probe.status === "pending_follow_up") {
      summary.pendingProbeCount += 1;
      continue;
    }

    if (probe.status === "missed_follow_up") {
      summary.missedFollowUpCount += 1;
      continue;
    }

    summary.evaluatedProbeCount += 1;
    if (probe.status === "passed") {
      summary.passedCount += 1;
    } else {
      summary.failedCount += 1;
    }

    if (probe.followUpAt) {
      const lagDays = (probe.followUpAt.getTime() - probe.anchorAt.getTime()) / DAY_MS;
      if (Number.isFinite(lagDays) && lagDays >= 0) {
        lagValues.get(probe.windowDays)?.push(lagDays);
      }
    }
  }

  const output = windows.map((windowDays) => {
    const summary = byWindow.get(windowDays)!;
    summary.passRate =
      summary.evaluatedProbeCount > 0
        ? round(summary.passedCount / summary.evaluatedProbeCount)
        : null;
    summary.completionRate =
      summary.dueProbeCount > 0
        ? round(summary.evaluatedProbeCount / summary.dueProbeCount)
        : null;
    summary.medianFollowUpLagDays = median(lagValues.get(windowDays) || []);
    return summary;
  });

  return output;
}

export function computeRetentionConfidence(params: {
  baseConfidence: number;
  windowSummaries: RetentionProbeWindowSummary[];
}): RetentionConfidenceSummary {
  const baseConfidence = clamp(params.baseConfidence, 0.2, 0.99);
  const totalDueProbeCount = params.windowSummaries.reduce((sum, row) => sum + row.dueProbeCount, 0);
  const totalEvaluatedProbeCount = params.windowSummaries.reduce(
    (sum, row) => sum + row.evaluatedProbeCount,
    0,
  );
  const totalPassedCount = params.windowSummaries.reduce((sum, row) => sum + row.passedCount, 0);
  const totalFailedCount = params.windowSummaries.reduce((sum, row) => sum + row.failedCount, 0);
  const totalMissedFollowUpCount = params.windowSummaries.reduce(
    (sum, row) => sum + row.missedFollowUpCount,
    0,
  );

  const blendedPassRate =
    totalEvaluatedProbeCount > 0 ? round(totalPassedCount / totalEvaluatedProbeCount) : null;
  const blendedCompletionRate =
    totalDueProbeCount > 0 ? round(totalEvaluatedProbeCount / totalDueProbeCount) : null;

  let weightedHealthSum = 0;
  let weightedHealthDenominator = 0;

  for (const row of params.windowSummaries) {
    if (row.dueProbeCount <= 0) continue;

    const passComponent = row.passRate ?? 0.5;
    const completionComponent = row.completionRate ?? 0;
    const windowHealth = passComponent * 0.85 + completionComponent * 0.15;
    const sampleWeight = clamp(row.dueProbeCount / 8, 0.25, 1);
    const weight = (WINDOW_WEIGHTS[row.windowDays] || 0.3) * sampleWeight;

    weightedHealthSum += windowHealth * weight;
    weightedHealthDenominator += weight;
  }

  const blendedHealth =
    weightedHealthDenominator > 0 ? weightedHealthSum / weightedHealthDenominator : null;

  let confidenceAdjustment = 0;
  if (blendedHealth !== null) {
    const sampleStrength = clamp(totalDueProbeCount / 24, 0, 1);
    const rawAdjustment = (blendedHealth - 0.7) * 0.18 * sampleStrength;
    confidenceAdjustment = round(clamp(rawAdjustment, -0.18, 0.06), 4);
  }

  const adjustedConfidence = round(clamp(baseConfidence + confidenceAdjustment, 0.2, 0.99), 2);

  return {
    protocolVersion: RETENTION_PROBE_PROTOCOL_VERSION,
    baseConfidence,
    adjustedConfidence,
    confidenceAdjustment,
    totalDueProbeCount,
    totalEvaluatedProbeCount,
    totalPassedCount,
    totalFailedCount,
    totalMissedFollowUpCount,
    blendedPassRate,
    blendedCompletionRate,
    windows: params.windowSummaries,
  };
}

export function buildRetentionConfidenceFromEvidence(params: {
  baseConfidence: number;
  rows: RetentionEvidenceObservation[];
  now?: Date;
  windows?: readonly RetentionWindowDays[];
  passScore?: number;
  graceDays?: number;
}) {
  const probes = buildRetentionProbes({
    rows: params.rows,
    now: params.now,
    windows: params.windows,
    passScore: params.passScore,
    graceDays: params.graceDays,
  });

  const windowSummaries = summarizeRetentionProbesByWindow({
    probes,
    windows: params.windows,
  });

  return {
    probes,
    confidence: computeRetentionConfidence({
      baseConfidence: params.baseConfidence,
      windowSummaries,
    }),
  };
}

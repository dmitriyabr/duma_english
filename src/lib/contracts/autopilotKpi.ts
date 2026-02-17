import { createHash } from "node:crypto";
import { z } from "zod";

export const AUTOPILOT_KPI_CONTRACT_VERSION = "autopilot-kpi-v1" as const;
const ISO_DATETIME = z.string().datetime({ offset: true });

export const AUTOPILOT_KPI_METRIC_IDS = [
  "mastery_gain_per_hour",
  "verified_growth_per_100_attempts",
  "retention_pass_rate_7d",
  "retention_pass_rate_30d",
  "retention_pass_rate_90d",
  "ood_pass_rate",
  "frustration_proxy_rate",
  "planner_latency_p95_ms",
] as const;

export type AutopilotKpiMetricId = (typeof AUTOPILOT_KPI_METRIC_IDS)[number];
export const autopilotKpiMetricIdSchema = z.enum(AUTOPILOT_KPI_METRIC_IDS);

export const autopilotKpiDirectionSchema = z.enum(["higher_is_better", "lower_is_better"]);

export const autopilotKpiMetricDefinitionSchema = z
  .object({
    id: autopilotKpiMetricIdSchema,
    label: z.string().min(1),
    unit: z.string().min(1),
    direction: autopilotKpiDirectionSchema,
    minSampleSize: z.number().int().positive(),
    description: z.string().min(1),
  })
  .strict();

type MetricDefinitionSeed = Omit<z.infer<typeof autopilotKpiMetricDefinitionSchema>, "id">;

const KPI_DEFINITION_SEED: Record<AutopilotKpiMetricId, MetricDefinitionSeed> = {
  mastery_gain_per_hour: {
    label: "Mastery gain per active hour",
    unit: "mastery_points/hour",
    direction: "higher_is_better",
    minSampleSize: 20,
    description: "Net mastery delta from node outcomes divided by active attempt hours.",
  },
  verified_growth_per_100_attempts: {
    label: "Verified growth",
    unit: "verified_transitions/100_attempts",
    direction: "higher_is_better",
    minSampleSize: 20,
    description: "Activation transitions to verified normalized to 100 completed attempts.",
  },
  retention_pass_rate_7d: {
    label: "Retention pass rate (7d)",
    unit: "ratio_0_1",
    direction: "higher_is_better",
    minSampleSize: 10,
    description: "Pass rate on 7-day delayed direct follow-up checks.",
  },
  retention_pass_rate_30d: {
    label: "Retention pass rate (30d)",
    unit: "ratio_0_1",
    direction: "higher_is_better",
    minSampleSize: 10,
    description: "Pass rate on 30-day delayed direct follow-up checks.",
  },
  retention_pass_rate_90d: {
    label: "Retention pass rate (90d)",
    unit: "ratio_0_1",
    direction: "higher_is_better",
    minSampleSize: 10,
    description: "Pass rate on 90-day delayed direct follow-up checks.",
  },
  ood_pass_rate: {
    label: "OOD pass rate",
    unit: "ratio_0_1",
    direction: "higher_is_better",
    minSampleSize: 20,
    description: "Transfer pass rate over evaluable OOD verdicts.",
  },
  frustration_proxy_rate: {
    label: "Frustration proxy rate",
    unit: "ratio_0_1",
    direction: "lower_is_better",
    minSampleSize: 20,
    description: "Rate of retry/recovery/low-score friction signals over terminal attempts.",
  },
  planner_latency_p95_ms: {
    label: "Planner latency p95",
    unit: "ms",
    direction: "lower_is_better",
    minSampleSize: 50,
    description: "p95 latency of planner decision writes.",
  },
};

export const AUTOPILOT_KPI_DEFINITIONS = Object.fromEntries(
  AUTOPILOT_KPI_METRIC_IDS.map((id) => [id, autopilotKpiMetricDefinitionSchema.parse({ id, ...KPI_DEFINITION_SEED[id] })])
) as Record<AutopilotKpiMetricId, z.infer<typeof autopilotKpiMetricDefinitionSchema>>;

export const autopilotKpiMetricStatusSchema = z.enum(["ok", "insufficient_data", "not_available"]);
export type AutopilotKpiMetricStatus = z.infer<typeof autopilotKpiMetricStatusSchema>;

export const autopilotKpiMetricSnapshotSchema = z
  .object({
    metricId: autopilotKpiMetricIdSchema,
    value: z.number().finite().nullable(),
    sampleSize: z.number().int().min(0),
    windowDays: z.number().int().positive(),
    numerator: z.number().finite().nullable().optional(),
    denominator: z.number().finite().nullable().optional(),
    status: autopilotKpiMetricStatusSchema,
    notes: z.string().min(1).optional(),
  })
  .strict();

export const autopilotKpiWindowSchema = z
  .object({
    from: ISO_DATETIME,
    to: ISO_DATETIME,
    windowDays: z.number().int().positive(),
  })
  .strict();

export const autopilotKpiMetricComparisonSchema = z
  .object({
    metricId: autopilotKpiMetricIdSchema,
    currentValue: z.number().finite().nullable(),
    baselineValue: z.number().finite().nullable(),
    delta: z.number().finite().nullable(),
    deltaPct: z.number().finite().nullable(),
  })
  .strict();

export const autopilotKpiBaselineSignoffSchema = z
  .object({
    signedBy: z.string().min(1),
    signedAt: ISO_DATETIME,
    signature: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  })
  .strict();

export const autopilotKpiBaselineReportSchema = z
  .object({
    reportId: z.string().min(1),
    contractVersion: z.literal(AUTOPILOT_KPI_CONTRACT_VERSION),
    generatedAt: ISO_DATETIME,
    window: autopilotKpiWindowSchema,
    metrics: z.array(autopilotKpiMetricSnapshotSchema).length(AUTOPILOT_KPI_METRIC_IDS.length),
    signoff: autopilotKpiBaselineSignoffSchema,
  })
  .strict();

export const autopilotKpiDashboardSchema = z
  .object({
    contractVersion: z.literal(AUTOPILOT_KPI_CONTRACT_VERSION),
    generatedAt: ISO_DATETIME,
    window: autopilotKpiWindowSchema,
    metrics: z.array(autopilotKpiMetricSnapshotSchema).length(AUTOPILOT_KPI_METRIC_IDS.length),
    baseline: z
      .object({
        reportId: z.string().min(1),
        signedBy: z.string().min(1),
        signedAt: ISO_DATETIME,
        signature: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      })
      .strict()
      .optional(),
    comparisons: z.array(autopilotKpiMetricComparisonSchema).optional(),
    warnings: z.array(z.string()).default([]),
  })
  .strict();

export type AutopilotKpiMetricDefinition = z.infer<typeof autopilotKpiMetricDefinitionSchema>;
export type AutopilotKpiMetricSnapshot = z.infer<typeof autopilotKpiMetricSnapshotSchema>;
export type AutopilotKpiMetricComparison = z.infer<typeof autopilotKpiMetricComparisonSchema>;
export type AutopilotKpiWindow = z.infer<typeof autopilotKpiWindowSchema>;
export type AutopilotKpiBaselineReport = z.infer<typeof autopilotKpiBaselineReportSchema>;
export type AutopilotKpiDashboard = z.infer<typeof autopilotKpiDashboardSchema>;

function roundMetric(value: number) {
  return Number(value.toFixed(4));
}

function metricCoverageMap(metrics: AutopilotKpiMetricSnapshot[]) {
  const byId = new Map<AutopilotKpiMetricId, AutopilotKpiMetricSnapshot>();
  for (const metric of metrics) {
    if (byId.has(metric.metricId)) {
      throw new Error(`Duplicate KPI snapshot for metricId=${metric.metricId}`);
    }
    byId.set(metric.metricId, metric);
  }
  for (const metricId of AUTOPILOT_KPI_METRIC_IDS) {
    if (!byId.has(metricId)) {
      throw new Error(`Missing KPI snapshot for metricId=${metricId}`);
    }
  }
  return byId;
}

export function sortMetricSnapshots(metrics: AutopilotKpiMetricSnapshot[]) {
  const byId = metricCoverageMap(metrics);
  return AUTOPILOT_KPI_METRIC_IDS.map((metricId) => byId.get(metricId) as AutopilotKpiMetricSnapshot);
}

export function buildMetricSnapshot(params: {
  metricId: AutopilotKpiMetricId;
  value: number | null;
  sampleSize: number;
  windowDays: number;
  numerator?: number | null;
  denominator?: number | null;
  notes?: string;
  status?: AutopilotKpiMetricStatus;
}): AutopilotKpiMetricSnapshot {
  const definition = AUTOPILOT_KPI_DEFINITIONS[params.metricId];
  const roundedValue = typeof params.value === "number" ? roundMetric(params.value) : null;
  const roundedNumerator = typeof params.numerator === "number" ? roundMetric(params.numerator) : params.numerator;
  const roundedDenominator =
    typeof params.denominator === "number" ? roundMetric(params.denominator) : params.denominator;
  const inferredStatus: AutopilotKpiMetricStatus =
    roundedValue === null
      ? "not_available"
      : params.sampleSize < definition.minSampleSize
      ? "insufficient_data"
      : "ok";

  return autopilotKpiMetricSnapshotSchema.parse({
    metricId: params.metricId,
    value: roundedValue,
    sampleSize: params.sampleSize,
    windowDays: params.windowDays,
    numerator: roundedNumerator,
    denominator: roundedDenominator,
    status: params.status || inferredStatus,
    notes: params.notes,
  });
}

export function buildMetricComparison(params: {
  metricId: AutopilotKpiMetricId;
  currentValue: number | null;
  baselineValue: number | null;
}): AutopilotKpiMetricComparison {
  const current = typeof params.currentValue === "number" ? roundMetric(params.currentValue) : null;
  const baseline = typeof params.baselineValue === "number" ? roundMetric(params.baselineValue) : null;
  const delta = current !== null && baseline !== null ? roundMetric(current - baseline) : null;
  const deltaPct =
    delta !== null && baseline !== null && baseline !== 0 ? roundMetric((delta / baseline) * 100) : null;
  return autopilotKpiMetricComparisonSchema.parse({
    metricId: params.metricId,
    currentValue: current,
    baselineValue: baseline,
    delta,
    deltaPct,
  });
}

type BaselineSignaturePayload = {
  reportId: string;
  contractVersion: typeof AUTOPILOT_KPI_CONTRACT_VERSION;
  generatedAt: string;
  window: AutopilotKpiWindow;
  metrics: AutopilotKpiMetricSnapshot[];
  signedBy: string;
  signedAt: string;
};

function signBaselinePayload(payload: BaselineSignaturePayload) {
  const digest = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return `sha256:${digest}`;
}

export function buildSignedAutopilotKpiBaselineReport(params: {
  reportId: string;
  generatedAt: string;
  window: AutopilotKpiWindow;
  metrics: AutopilotKpiMetricSnapshot[];
  signedBy: string;
  signedAt: string;
}): AutopilotKpiBaselineReport {
  const orderedMetrics = sortMetricSnapshots(params.metrics);
  const payload: BaselineSignaturePayload = {
    reportId: params.reportId,
    contractVersion: AUTOPILOT_KPI_CONTRACT_VERSION,
    generatedAt: params.generatedAt,
    window: params.window,
    metrics: orderedMetrics,
    signedBy: params.signedBy,
    signedAt: params.signedAt,
  };
  const signature = signBaselinePayload(payload);
  return autopilotKpiBaselineReportSchema.parse({
    reportId: payload.reportId,
    contractVersion: payload.contractVersion,
    generatedAt: payload.generatedAt,
    window: payload.window,
    metrics: orderedMetrics,
    signoff: {
      signedBy: params.signedBy,
      signedAt: params.signedAt,
      signature,
    },
  });
}

export function verifyAutopilotKpiBaselineSignature(report: AutopilotKpiBaselineReport) {
  const payload: BaselineSignaturePayload = {
    reportId: report.reportId,
    contractVersion: report.contractVersion,
    generatedAt: report.generatedAt,
    window: report.window,
    metrics: sortMetricSnapshots(report.metrics),
    signedBy: report.signoff.signedBy,
    signedAt: report.signoff.signedAt,
  };
  return signBaselinePayload(payload) === report.signoff.signature;
}

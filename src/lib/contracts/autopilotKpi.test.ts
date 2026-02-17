import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTOPILOT_KPI_METRIC_IDS,
  buildMetricSnapshot,
  buildSignedAutopilotKpiBaselineReport,
  verifyAutopilotKpiBaselineSignature,
  autopilotKpiBaselineReportSchema,
  sortMetricSnapshots,
} from "./autopilotKpi";

test("signed KPI baseline report validates and has deterministic signature", () => {
  const metrics = AUTOPILOT_KPI_METRIC_IDS.map((metricId) =>
    buildMetricSnapshot({
      metricId,
      value: 1,
      sampleSize: 100,
      windowDays: metricId.startsWith("retention_pass_rate_")
        ? Number(metricId.split("_")[3].replace("d", ""))
        : 30,
    })
  );
  const reportA = buildSignedAutopilotKpiBaselineReport({
    reportId: "ch05-kpi-baseline-2026-02-17",
    generatedAt: "2026-02-17T22:20:00.000Z",
    window: {
      from: "2026-01-18T22:20:00.000Z",
      to: "2026-02-17T22:20:00.000Z",
      windowDays: 30,
    },
    metrics,
    signedBy: "Agent_1",
    signedAt: "2026-02-17T22:20:00.000Z",
  });
  const reportB = buildSignedAutopilotKpiBaselineReport({
    reportId: "ch05-kpi-baseline-2026-02-17",
    generatedAt: "2026-02-17T22:20:00.000Z",
    window: {
      from: "2026-01-18T22:20:00.000Z",
      to: "2026-02-17T22:20:00.000Z",
      windowDays: 30,
    },
    metrics,
    signedBy: "Agent_1",
    signedAt: "2026-02-17T22:20:00.000Z",
  });

  const parsed = autopilotKpiBaselineReportSchema.parse(reportA);
  assert.equal(verifyAutopilotKpiBaselineSignature(parsed), true);
  assert.equal(reportA.signoff.signature, reportB.signoff.signature);
});

test("signature verification fails after report mutation", () => {
  const metrics = sortMetricSnapshots(
    AUTOPILOT_KPI_METRIC_IDS.map((metricId) =>
      buildMetricSnapshot({
        metricId,
        value: 0.5,
        sampleSize: 100,
        windowDays: metricId.startsWith("retention_pass_rate_")
          ? Number(metricId.split("_")[3].replace("d", ""))
          : 30,
      })
    )
  );
  const report = buildSignedAutopilotKpiBaselineReport({
    reportId: "ch05-kpi-baseline-2026-02-17",
    generatedAt: "2026-02-17T22:20:00.000Z",
    window: {
      from: "2026-01-18T22:20:00.000Z",
      to: "2026-02-17T22:20:00.000Z",
      windowDays: 30,
    },
    metrics,
    signedBy: "Agent_1",
    signedAt: "2026-02-17T22:20:00.000Z",
  });

  const tampered = {
    ...report,
    metrics: report.metrics.map((metric) =>
      metric.metricId === "ood_pass_rate" ? { ...metric, value: 0.25 } : metric
    ),
  };

  assert.equal(verifyAutopilotKpiBaselineSignature(tampered), false);
});

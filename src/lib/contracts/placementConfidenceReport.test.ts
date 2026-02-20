import test from "node:test";
import assert from "node:assert/strict";
import {
  PLACEMENT_CONFIDENCE_REPORT_VERSION,
  placementConfidenceReportSchema,
} from "./placementConfidenceReport";

test("placement confidence report schema accepts valid payload", () => {
  const parsed = placementConfidenceReportSchema.parse({
    generatedAt: "2026-02-20T12:00:00.000Z",
    contractVersion: PLACEMENT_CONFIDENCE_REPORT_VERSION,
    windowDays: 90,
    totalPlacements: 42,
    byDomain: [
      { domain: "speaking", placementCount: 40, totalSampleCount: 120, avgConfidence: 0.72, avgUncertainty: 0.28 },
      { domain: "listening", placementCount: 38, totalSampleCount: 95, avgConfidence: 0.65, avgUncertainty: 0.35 },
      { domain: "reading", placementCount: 35, totalSampleCount: 88, avgConfidence: 0.7, avgUncertainty: 0.3 },
      { domain: "writing", placementCount: 30, totalSampleCount: 60, avgConfidence: 0.68, avgUncertainty: 0.32 },
      { domain: "grammar", placementCount: 42, totalSampleCount: 200, avgConfidence: 0.75, avgUncertainty: 0.25 },
      { domain: "vocabulary", placementCount: 42, totalSampleCount: 210, avgConfidence: 0.73, avgUncertainty: 0.27 },
    ],
  });

  assert.equal(parsed.contractVersion, PLACEMENT_CONFIDENCE_REPORT_VERSION);
  assert.equal(parsed.totalPlacements, 42);
  assert.equal(parsed.byDomain.length, 6);
  assert.equal(parsed.byDomain[0].domain, "speaking");
  assert.equal(parsed.byDomain[0].avgConfidence, 0.72);
});

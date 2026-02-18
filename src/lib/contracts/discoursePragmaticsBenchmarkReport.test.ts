import test from "node:test";
import assert from "node:assert/strict";
import { discoursePragmaticsBenchmarkReportSchema } from "./discoursePragmaticsBenchmarkReport";

test("discourse pragmatics benchmark schema accepts valid report", () => {
  const parsed = discoursePragmaticsBenchmarkReportSchema.parse({
    generatedAt: "2026-02-18T00:00:00.000Z",
    contractVersion: "discourse-pragmatics-benchmark-v1",
    engineVersion: "discourse-pragmatics-v1",
    windowDays: 30,
    totalAttempts: 40,
    discourseAttempts: 12,
    engineCoverageCount: 9,
    engineCoverageRate: 0.75,
    overallAgreementRate: 0.722222,
    dimensions: [
      {
        dimension: "argumentStructure",
        coverageCount: 9,
        enginePassRate: 0.666667,
        adjudicatedPassRate: 0.555556,
        agreementRate: 0.777778,
        meanAbsoluteError: 7.2,
      },
      {
        dimension: "registerControl",
        coverageCount: 9,
        enginePassRate: 0.777778,
        adjudicatedPassRate: 0.666667,
        agreementRate: 0.666667,
        meanAbsoluteError: 8.1,
      },
      {
        dimension: "turnTakingRepair",
        coverageCount: 9,
        enginePassRate: 0.555556,
        adjudicatedPassRate: 0.444444,
        agreementRate: 0.777778,
        meanAbsoluteError: 9.4,
      },
      {
        dimension: "cohesion",
        coverageCount: 9,
        enginePassRate: 0.666667,
        adjudicatedPassRate: 0.666667,
        agreementRate: 0.888889,
        meanAbsoluteError: 6.3,
      },
      {
        dimension: "audienceFit",
        coverageCount: 9,
        enginePassRate: 0.777778,
        adjudicatedPassRate: 0.666667,
        agreementRate: 0.5,
        meanAbsoluteError: 10.2,
      },
    ],
    byTaskType: [
      { taskType: "topic_talk", count: 4, agreementRate: 0.8 },
      { taskType: "role_play", count: 5, agreementRate: 0.7 },
    ],
  });

  assert.equal(parsed.contractVersion, "discourse-pragmatics-benchmark-v1");
  assert.equal(parsed.dimensions.length, 5);
});

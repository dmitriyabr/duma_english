import {
  buildOfflineReplayDataset,
  type OfflineReplayDataset,
} from "@/lib/replay/offlineDataset";
import {
  replayDatasetCompletenessReportSchema,
  type ReplayDatasetCompletenessReport,
} from "@/lib/contracts/replayDatasetCompleteness";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export type ReplayDatasetCompletenessParams = {
  windowDays?: number;
  eventLimit?: number;
  decisionLimit?: number;
  sampleLimit?: number;
};

export type ReplayDatasetCompletenessArtifact = {
  dataset: OfflineReplayDataset;
  report: ReplayDatasetCompletenessReport;
};

export async function buildReplayDatasetCompletenessArtifact(
  params?: ReplayDatasetCompletenessParams
): Promise<ReplayDatasetCompletenessArtifact> {
  const windowDays = clamp(params?.windowDays ?? 30, 1, 365);
  const eventLimit = clamp(params?.eventLimit ?? 50000, 500, 200000);
  const decisionLimit = clamp(params?.decisionLimit ?? 5000, 100, 50000);
  const sampleLimit = clamp(params?.sampleLimit ?? 20, 1, 200);

  const dataset = await buildOfflineReplayDataset({
    windowDays,
    eventLimit,
    decisionLimit,
  });

  const report = replayDatasetCompletenessReportSchema.parse({
    generatedAt: new Date().toISOString(),
    datasetVersion: dataset.datasetVersion,
    windowDays,
    eventLimit,
    decisionLimit,
    summary: {
      totalEvents: dataset.totalEvents,
      totalDecisionGroups: dataset.totalDecisionGroups,
      completeRows: dataset.completeness.completeRows,
      incompleteRows: dataset.completeness.incompleteRows,
      completenessRate: dataset.completeness.completenessRate,
      eventTypeCounts: dataset.eventTypeCounts,
      missing: {
        missingDecisionEvent: dataset.completeness.missingDecisionEvent,
        missingTaskInstanceEvent: dataset.completeness.missingTaskInstanceEvent,
        missingAttemptEvent: dataset.completeness.missingAttemptEvent,
        missingDelayedOutcomeEvent: dataset.completeness.missingDelayedOutcomeEvent,
        missingOutcomePayload: dataset.completeness.missingOutcomePayload,
        missingLinkage: dataset.completeness.missingLinkage,
      },
    },
    incompleteSamples: dataset.rows
      .filter((row) => !row.completeness.isComplete)
      .slice(0, sampleLimit)
      .map((row) => ({
        decisionLogId: row.decisionLogId,
        studentId: row.studentId,
        missing: row.completeness.missing,
        timestamps: {
          decisionTs: row.timestamps.decisionTs,
          delayedOutcomeTs: row.timestamps.delayedOutcomeTs,
        },
      })),
  });

  return { dataset, report };
}

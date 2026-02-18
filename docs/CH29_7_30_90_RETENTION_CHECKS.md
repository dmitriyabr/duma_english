# CH-29 — 7/30/90 Retention Checks

Last updated: 2026-02-18

## Goal

Add delayed retention probes for 7/30/90-day windows and make their outcomes influence stage confidence while publishing a cohort report by stage/domain.

Execution-board DoD:
1. Delayed retention probes are implemented for 7/30/90 windows.
2. Probe outcomes participate in stage confidence.
3. Artifact provides retention cohort report by stage/domain.

## Implemented Components

1. Retention probes runtime module:
   - `src/lib/retention/probes.ts`
   - `src/lib/retention/probes.test.ts`
2. Stage-confidence integration:
   - `src/lib/gse/stageProjection.ts`
   - `src/lib/progress.ts`
3. Cohort quality contract and aggregator:
   - `src/lib/contracts/retentionCohortReport.ts`
   - `src/lib/contracts/retentionCohortReport.test.ts`
   - `src/lib/quality/retentionCohortReport.ts`
   - `src/lib/quality/retentionCohortReport.test.ts`
4. Quality API endpoint:
   - `GET /api/quality/retention-cohort`
   - `src/app/api/quality/retention-cohort/route.ts`
5. Report script:
   - `src/scripts/ch29_retention_cohort_report.ts`

## Runtime Protocol

Protocol version:

`retention-probes-v1`

### Probe construction

1. Build anchor events from direct evidence rows with score `>= 0.7`.
2. For each anchor, evaluate follow-up windows: `7`, `30`, `90` days.
3. Accept follow-up inside `[window, window + 21d grace]`.
4. Mark probe status:
   - `passed`
   - `failed`
   - `missed_follow_up`
   - `pending_follow_up`

### Stage-confidence integration

1. Stage projection loads direct retention evidence once (shared with retention promotion gate context).
2. Probe windows are summarized into pass/completion health.
3. Confidence receives a bounded retention adjustment (`confidenceAdjustment`) and returns `adjustedConfidence`.
4. Retention summary is stored in stage evidence and exposed through progress payload (`promotionReadiness.retention`).

## Cohort Artifact Surface

API:

`GET /api/quality/retention-cohort?windowDays=90&limit=60000`

Report dimensions:
1. `windowDays` (`7/30/90`)
2. `stage` (`A0..C2`)
3. `domain` (`vocab|grammar|communication|other`)

Key metrics:
1. `dueProbeCount`
2. `evaluatedProbeCount`
3. `passedCount`
4. `failedCount`
5. `missedFollowUpCount`
6. `passRate`
7. `completionRate`
8. `medianFollowUpLagDays`
9. `uniqueStudents`, `uniqueNodes`

Script:

`npx tsx src/scripts/ch29_retention_cohort_report.ts --window-days 90 --limit 60000 --output docs/reports/CH29_RETENTION_COHORT_REPORT.json`

Local artifact snapshot (current seed):
- `totalEvidenceRows=137`
- `totalDueProbeCount=104`
- `totalEvaluatedProbeCount=0`
- `overallPassRate=null`

## Invariants Preserved

1. Additive implementation: no destructive schema changes.
2. CH-30 retention promotion blockers remain unchanged and continue to own hard-gate logic.
3. CH-29 affects confidence calibration only and provides independent cohort observability.

# CH-20 Offline Replay Dataset Builder

## Goal

Build an offline training dataset from immutable event logs with the shape:
`context -> action -> delayed outcome`.

Execution-board DoD:
1. Replay dataset job exists and is deterministic.
2. Completeness stats are produced for promotion-gate readiness.

## Implementation

### Replay dataset builder
- `src/lib/replay/offlineDataset.ts`
- `src/lib/replay/offlineDataset.test.ts`

Added:
1. Versioned dataset builder `offline-replay-dataset-v1`.
2. Event stitching for decision lifecycle:
   - `planner_decision_created`
   - `task_instance_created`
   - `attempt_created`
   - `delayed_outcome_recorded`
3. Dataset row materialization with explicit linkage/timestamps/context/action/outcome payload.
4. Deterministic completeness flags and missing-reason breakdown per decision.
5. Dataset serialization helper (`json` / `ndjson`) for downstream OPE/shadow jobs.

### Completeness contract + quality endpoint
- `src/lib/contracts/replayDatasetCompleteness.ts`
- `src/lib/contracts/replayDatasetCompleteness.test.ts`
- `src/lib/quality/replayDatasetCompleteness.ts`
- `src/app/api/quality/replay-dataset-completeness/route.ts`

Added:
1. Versioned report schema for dataset completeness stats.
2. Artifact builder returning both dataset and completeness report.
3. Auth-protected quality API endpoint:
   - `GET /api/quality/replay-dataset-completeness`

### Replay dataset job artifact
- `src/scripts/ch20_offline_replay_dataset_report.ts`
- `docs/reports/CH20_OFFLINE_REPLAY_DATASET.ndjson`
- `docs/reports/CH20_OFFLINE_REPLAY_DATASET_REPORT.json`

CLI job:
```bash
npm run replay:dataset -- --window-days 30
```

Output:
1. Replay dataset file (`ndjson` by default).
2. Completeness report with:
   - total decision groups
   - complete vs incomplete rows
   - completeness rate
   - missing-linkage counters
   - sample incomplete rows

## Validation

Executed for CH-20:
1. `npx tsx --test src/lib/replay/offlineDataset.test.ts src/lib/contracts/replayDatasetCompleteness.test.ts` ✅
2. `npm run replay:dataset -- --window-days 30 --dataset-output docs/reports/CH20_OFFLINE_REPLAY_DATASET.ndjson --report-output docs/reports/CH20_OFFLINE_REPLAY_DATASET_REPORT.json` ✅
3. `npm run lint` ✅
4. `npm run build` ✅

Current local report snapshot (seed-dependent):
1. `totalDecisionGroups = 0`
2. `completenessRate = 0`

This indicates no replay-eligible decision traces in the local 30-day window, while the job/contract path is fully operational.

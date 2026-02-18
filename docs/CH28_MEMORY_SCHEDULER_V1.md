# CH-28 — Memory Scheduler v1

## Objective
Introduce a node-level memory scheduler that maintains a review queue portfolio (`fresh`, `review`, `transfer`) with explicit fragile-node prioritization and measurable queue-health telemetry.

## What Landed

### 1) Scheduler runtime
- Added `src/lib/memory/scheduler.ts` (`memory-scheduler-v1`).
- Added per-node planning logic from `StudentGseMastery` into:
  - `memory_fresh` (`fresh_consolidation`) for low-evidence consolidation.
  - `memory_review` (`verification_due`, `memory_overdue`, `fragile_decay_risk`) for due/at-risk retrieval.
- Added fragile-node scoring (`computeFragilityScore`) based on:
  - decayed mastery,
  - uncertainty,
  - sparse/direct evidence,
  - negative evidence skew.
- Added sync primitives:
  - `syncMemorySchedulerForStudent`.
  - `syncMemorySchedulerForStudents`.
- Sync behavior:
  - upsert open queue items for planned nodes,
  - update reason/priority/due date when plan changes,
  - close stale open memory items that are no longer due.

### 2) Quality contract + dashboard
- Added `src/lib/contracts/memorySchedulerDashboard.ts`.
- Added `src/lib/quality/memorySchedulerDashboard.ts`.
- Dashboard metrics include:
  - queue totals and open backlog,
  - overdue open items,
  - due-miss count/rate,
  - median queue latency,
  - median open age,
  - fragile-open load,
  - portfolio breakdown (`fresh/review/transfer`),
  - reason breakdown.

### 3) API + report script
- Added API endpoint:
  - `GET /api/quality/memory-scheduler`
- Added report script:
  - `src/scripts/ch28_memory_scheduler_report.ts`
  - supports `--sync` to run scheduler sync before report generation.

## Queue Portfolio Semantics
- `fresh`: short-horizon consolidation for nodes with sparse direct evidence.
- `review`: due/overdue/fragile decay prevention queue.
- `transfer`: existing transfer remediation queue (`transfer_remediation`) is included in portfolio telemetry.

## Verification
- Unit tests:
  - `src/lib/memory/scheduler.test.ts`
  - `src/lib/contracts/memorySchedulerDashboard.test.ts`
  - `src/lib/quality/memorySchedulerDashboard.test.ts`
- Report generation command:
  - `npx tsx src/scripts/ch28_memory_scheduler_report.ts --sync --window-days 30 --output docs/reports/CH28_MEMORY_SCHEDULER_REPORT.json`

## Invariants Preserved
- Additive only: no destructive schema/runtime removals.
- Existing transfer remediation flow remains source of truth for transfer queue items.
- Scheduler writes only `ReviewQueueItem` rows under memory queue types and does not mutate unrelated queue protocols.

# CH-24 Fast-Lane Progression Protocol

## Goal

Automatically reduce diagnostic and OOD density for high-confidence learners between milestone gates.

Execution-board DoD:
1. High-confidence learners get lower diagnostic/OOD density between milestone gates.
2. Fast-lane cohort report provides velocity vs safety artifact.

## Implementation

### Fast-lane policy module
- `src/lib/policy/fastLane.ts`
- `src/lib/policy/fastLane.test.ts`

Added:
1. Versioned policy contract: `fast-lane-progression-v1`.
2. Eligibility logic:
   - high confidence (`projectionConfidence`, `placementConfidence`, `placementUncertainty` thresholds)
   - between milestone gates (not promotion-ready, no stress-gate window)
   - warmup complete (no cold-start and no placement-fresh mode)
3. Runtime actions when eligible:
   - diagnostic density throttled (`diagnosticMode -> false`)
   - OOD budget downshift via additive delta (`-0.02` rate)

### Runtime integration (task-next + OOD controller)
- `src/app/api/task/next/route.ts`
- `src/lib/ood/budgetController.ts`
- `src/lib/ood/budgetController.test.ts`
- `src/lib/ood/generator.test.ts`

Added:
1. Fast-lane decision computed in task runtime from stage projection/profile signals.
2. Planner diagnostic flag is now fast-lane-aware (less diagnostics for eligible learners).
3. OOD budget controller accepts fast-lane signal and applies rate delta within existing 10-20% guardrails.
4. Fast-lane trace is persisted in task metadata and returned from `/api/task/next`.

### Velocity vs safety cohort telemetry
- `src/lib/contracts/fastLaneCohortReport.ts`
- `src/lib/contracts/fastLaneCohortReport.test.ts`
- `src/lib/quality/fastLaneCohortReport.ts`
- `src/lib/quality/fastLaneCohortReport.test.ts`
- `src/app/api/quality/fast-lane-cohort/route.ts`
- `src/scripts/ch24_fast_lane_cohort_report.ts`

Artifact fields:
1. Cohorts: `fast_lane` vs `standard`.
2. Velocity: tasks per learner per day, median inter-task latency.
3. Safety: diagnostic rate, OOD injection rate, transfer fail rate, needs-retry rate.
4. Delta block: velocity/safety lift vs standard cohort.

## Validation

Executed for CH-24:
1. `npx tsx --test src/lib/policy/fastLane.test.ts src/lib/contracts/fastLaneCohortReport.test.ts src/lib/quality/fastLaneCohortReport.test.ts src/lib/ood/budgetController.test.ts src/lib/ood/generator.test.ts` ✅
2. `npm run fast-lane:cohort -- --window-days 30 --output docs/reports/CH24_FAST_LANE_COHORT_REPORT.json` ✅
3. `npm run lint` ✅
4. `npm run build` ✅

Current local report snapshot:
1. `totalLearners = 6`, `totalTasks = 198`
2. `fast_lane tasks = 0` (expected for pre-rollout historical window)
3. Baseline standard diagnostic rate = `0.207071` and needs-retry rate = `0.008696`

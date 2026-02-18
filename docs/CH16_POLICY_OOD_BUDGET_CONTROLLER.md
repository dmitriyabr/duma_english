# CH-16 Policy OOD Budget Controller

Last updated: 2026-02-18

## Goal

Move OOD injection from fixed cadence to budget control with dynamic escalation for milestone and overfit risk.

## Budget protocol (v1)

Controller version: `ood-budget-controller-v1`

1. Base OOD budget rate: `0.14` (~14%, inside required 10-20% band).
2. Milestone pressure boost: `+0.03` when planner is in verification/milestone-like goal state.
3. Overfit-risk boost: `+0.03` when recent OOD outcomes show low transfer pass-rate (`<0.5` with enough samples) or fail streak.
4. Final budget is clamped to `[0.10, 0.20]`.
5. Budget is converted to dynamic cadence interval (`5..10` tasks), then OOD injection follows this interval.

## Runtime integration

- Controller logic: `src/lib/ood/budgetController.ts`
- OOD generator uses dynamic interval and writes controller telemetry into OOD metadata:
  - `src/lib/ood/generator.ts`
- Task runtime wiring:
  - `src/app/api/task/next/route.ts`
  - Additive API field `oodBudget`
  - Per-task telemetry in task meta: `oodBudgetController`

## Telemetry artifact

Per-learner OOD budget telemetry:

`npx tsx src/scripts/ch16_ood_budget_telemetry_report.ts --window-days 30 --output docs/reports/CH16_OOD_BUDGET_TELEMETRY_REPORT.json`

Quality endpoint:

`GET /api/quality/ood-budget?windowDays=30&limit=20000`

Telemetry includes per learner:

1. total tasks
2. OOD injected tasks
3. realized OOD rate
4. average target budget rate/interval
5. milestone-pressure and overfit-risk task counts
6. outside-target-band marker (`<10%` or `>20%` realized rate)

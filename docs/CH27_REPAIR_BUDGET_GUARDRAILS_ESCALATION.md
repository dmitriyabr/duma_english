# CH-27 Repair Budget Guardrails + Escalation

## Goal

Enforce immediate self-repair loop budgets and trigger automatic escalation when deadlock/budget exhaustion is detected.

Execution-board DoD:
1. Budget limits are enforced:
   - `<=2` immediate loops per skill/session
   - `<=25%` session time share for immediate loops
2. Automatic escalation path is triggered when budget is exhausted.
3. Budget exhaustion telemetry artifact is available.

## Implementation

### Budget guardrails runtime
- `src/lib/selfRepair/budgetGuardrails.ts`
- `src/lib/selfRepair/budgetGuardrails.test.ts`

Added:
1. Versioned guardrails contract: `self-repair-budget-guardrails-v1`.
2. Session window: 90 minutes.
3. Per-skill cap: max 2 immediate loops per session.
4. Time-share cap: projected immediate loop share <= 25% of session duration.
5. Deterministic budget evaluator and DB-backed usage computation.

### Immediate loop escalation path
- `src/lib/selfRepair/immediateLoop.ts`
- `src/worker/index.ts`

Added:
1. `createImmediateSelfRepairCycle` now computes budget usage before opening pending immediate retry.
2. If budget is exhausted:
   - cycle is created with `status=escalated`
   - escalation queue item is created with `queueType=self_repair_escalation` (when target node is available)
   - metadata stores budget snapshot + exhaustion reasons.
3. Worker log now emits budget/exhaustion/escalation details for observability.

### Budget exhaustion telemetry
- `src/lib/contracts/selfRepairBudgetTelemetry.ts`
- `src/lib/contracts/selfRepairBudgetTelemetry.test.ts`
- `src/lib/quality/selfRepairBudgetTelemetry.ts`
- `src/lib/quality/selfRepairBudgetTelemetry.test.ts`
- `src/app/api/quality/self-repair-budget/route.ts`
- `src/scripts/ch27_self_repair_budget_telemetry_report.ts`
- `docs/reports/CH27_SELF_REPAIR_BUDGET_TELEMETRY_REPORT.json`

Telemetry outputs:
1. `budgetExhaustedCount` and `budgetExhaustedRate`
2. `escalatedCount`
3. escalation queue open/completed counters
4. projected immediate-share metrics and exhaustion reason breakdown

## Validation

Executed for CH-27:
1. `npx tsx --test src/lib/selfRepair/budgetGuardrails.test.ts src/lib/selfRepair/immediateLoop.test.ts src/lib/contracts/selfRepairBudgetTelemetry.test.ts src/lib/quality/selfRepairBudgetTelemetry.test.ts src/lib/contracts/selfRepairImmediateLoopReport.test.ts src/lib/quality/selfRepairImmediateLoopReport.test.ts` ✅
2. `npm run self-repair:budget -- --window-days 30 --output docs/reports/CH27_SELF_REPAIR_BUDGET_TELEMETRY_REPORT.json` ✅
3. `npm run lint` ✅
4. `npm run build` ✅

Current local telemetry snapshot:
1. `totalCycles = 0`
2. `budgetExhaustedCount = 0`
3. `escalatedCount = 0`

# CH-22 Learned Value Model in Shadow Mode

Last updated: 2026-02-18

## Goal

Run a learned value scorer in shadow alongside the rule planner, with zero impact on learner-facing action selection.

Execution-board DoD:
1. Learned scorer runs in shadow mode (no control over runtime action choice).
2. Shadow disagreement dashboard and safety counters are observable.

## Implemented components

1. Shadow value scorer module: `src/lib/shadow/valueModel.ts`
2. Planner shadow trace wiring: `src/lib/gse/planner.ts`
3. Quality contract + dashboard aggregator:
   - `src/lib/contracts/shadowPolicyDashboard.ts`
   - `src/lib/quality/shadowPolicyDashboard.ts`
4. Quality API endpoint: `src/app/api/quality/shadow-policy/route.ts`
5. Report script: `src/scripts/ch22_shadow_policy_dashboard_report.ts`
6. Tests:
   - `src/lib/shadow/valueModel.test.ts`
   - `src/lib/contracts/shadowPolicyDashboard.test.ts`
   - `src/lib/quality/shadowPolicyDashboard.test.ts`

## Shadow model protocol

Shadow model version:

`shadow-linear-contextual-v1`

Runtime behavior:
1. Shadow scorer computes candidate values in parallel to rule planner scoring.
2. Learned priors are derived from recent same-session `RewardTrace` outcomes (task-type reward priors with shrinkage).
3. Feature contribution is added from candidate metrics (`expectedGain`, `successProbability`, `verificationGain`, `engagementRisk`, `latencyRisk`, etc.).
4. Final learner-facing action remains the rule planner choice; shadow result is trace-only.

Safety counters (shadow-only):
1. `highRiskDisagreementCount`
2. `verificationGuardTrips`
3. `blockedBySafetyGuardCount`

Trace storage:
1. `PlannerDecisionLog.utilityJson.shadowPolicy`
2. Additive summary in planner event payload (`shadowPolicyDisagreement`, `shadowPolicyBlockedBySafetyGuard`).

## Dashboard artifact

API:

`GET /api/quality/shadow-policy?windowDays=30&limit=5000`

Core metrics:
1. trace coverage (`tracedDecisions / totalDecisions`)
2. disagreement rate (raw + after safety guard)
3. blocked-by-safety-guard rate
4. average value gap vs rules
5. safety counter totals and disagreement distribution by rule-chosen task type

Script:

`npx tsx src/scripts/ch22_shadow_policy_dashboard_report.ts --window-days 30 --output docs/reports/CH22_SHADOW_POLICY_DASHBOARD.json`

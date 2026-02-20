# CH-45 — Latency/Reliability SLO Enforcement

**Status:** DONE  
**Artifact:** SLO dashboard + synthetic canary checks + enforcement fallback.

## Goal

- Define latency (and optional reliability) budgets for critical modules.
- When SLO is breached, switch flow to deterministic fallback without losing invariants.
- Expose SLO dashboard and synthetic canary checks.

## Implementation

### Contract

- `src/lib/contracts/sloDashboard.ts`: SloModuleId (planner), SloModuleStatus (latencyBudgetP95Ms, latencyP95Ms, status: ok | breach | insufficient_data), SloDashboard. Default planner budget: 5000 ms p95, window 1 day.

### Dashboard

- `src/lib/quality/sloDashboard.ts`:
  - `buildSloDashboard({ windowDays, plannerBudgetP95Ms })` — reads PlannerDecisionLog.latencyMs, computes p95, compares to budget; returns dashboard with modules and enforcementActive (from SLO_PLANNER_ENFORCE).
  - `isPlannerSloBreached({ windowDays, budgetP95Ms })` — returns true when planner status is breach (used for enforcement).

### API and scripts

- **API:** GET `/api/quality/slo-dashboard?windowDays=1` (student auth).
- **Scripts:**
  - `npm run slo:dashboard` → writes `docs/reports/CH45_SLO_DASHBOARD.json` (optional `--window-days`, `--output`).
  - `npm run slo:canary` → runs one planner decision (rule-only) with a test student, records latency to `docs/reports/CH45_SLO_CANARY_LOG.ndjson`.

### Enforcement

- **Planner:** `planNextTaskDecision` accepts `useRuleOnly?: boolean`. When true, shadow value model is skipped and hybrid selector uses ruleWeight=1, learnedWeight=0 (deterministic rule-only choice).
- **task/next:** When `SLO_PLANNER_ENFORCE=true`, before calling the planner we call `isPlannerSloBreached({ windowDays: 1 })`; if true, we pass `useRuleOnly: true` so the request is served with rule-only planner and no shadow call. Invariants (targetNodeIds, task type, evidence path) are preserved.

### Environment

- `SLO_PLANNER_ENFORCE` — set to `true` to enable planner fallback on SLO breach (default off).
- Planner budget and window use defaults (5000 ms p95, 1 day); can be overridden in code or future env.

## References

- Planner latency: PlannerDecisionLog.latencyMs, `src/lib/kpi/autopilotDashboard.ts` planner_latency_p95_ms.
- Hybrid selector: `src/lib/policy/hybridSelector.ts` (ruleWeight, learnedWeight).
- Planner: `src/lib/gse/planner.ts` (useRuleOnly, shadow skip, hybrid weights).

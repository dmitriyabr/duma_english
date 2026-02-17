# CH-05 KPI Contract + Baseline Freeze

Last updated: 2026-02-17

## Scope

CH-05 defines a versioned KPI contract and frozen baseline for these metrics:

1. `mastery_gain_per_hour`
2. `verified_growth_per_100_attempts`
3. `retention_pass_rate_7d`
4. `retention_pass_rate_30d`
5. `retention_pass_rate_90d`
6. `ood_pass_rate`
7. `frustration_proxy_rate`
8. `planner_latency_p95_ms`

Contract version: `autopilot-kpi-v1`.

## Metric Formulas (v1)

1. `mastery_gain_per_hour` = `sum(nodeOutcomes.deltaMastery) / active_attempt_hours`.
2. `verified_growth_per_100_attempts` = `verified_transitions / completed_attempts * 100`.
3. `retention_pass_rate_{7,30,90}d` = delayed direct follow-up pass ratio for anchors with score `>= 0.7` and follow-up in `[window, window+21d]`.
4. `ood_pass_rate` = `ood_pass / (ood_pass + ood_fail)` over evaluable verdicts.
5. `frustration_proxy_rate` = `(needs_retry OR recoveryTriggered OR taskScore<45) / terminal_attempts`.
6. `planner_latency_p95_ms` = p95 of `PlannerDecisionLog.latencyMs`.

Sample sufficiency thresholds are embedded in `src/lib/contracts/autopilotKpi.ts`.

## Dashboard Artifact

Endpoint:

- `GET /api/quality/autopilot-kpi?windowDays=30`

Output contains:

1. KPI snapshots (value, sample size, status).
2. Optional comparison against frozen baseline report.
3. Warnings if baseline is missing/invalid or DB is unavailable.

## Signed Baseline Freeze Artifact

Freeze script:

- `npm run kpi:baseline:freeze`

Generated files:

1. `docs/reports/CH05_KPI_BASELINE_REPORT.json`
2. `docs/reports/CH05_KPI_BASELINE_REPORT.md`

Signing:

1. SHA-256 signature is computed over report payload + signoff metadata.
2. Signature validation is implemented in `verifyAutopilotKpiBaselineSignature`.

## Verification Commands

1. `npm test -- src/lib/contracts/autopilotKpi.test.ts src/lib/kpi/autopilotDashboard.test.ts`
2. `npm run lint`
3. `npm run build`

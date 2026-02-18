# CH-21 Off-Policy Evaluation Pipeline

Last updated: 2026-02-18

## Goal

Implement OPE that reports policy lift with confidence bounds and automatically excludes incomplete logs from evaluation.

## Implemented components

1. OPE report contract: `src/lib/contracts/opeReport.ts`
2. OPE engine: `src/lib/ope/offPolicyEvaluation.ts`
3. Quality API endpoint: `src/app/api/quality/ope/route.ts`
4. OPE report script: `src/scripts/ch21_ope_report.ts`
5. CI/CD promotion gate workflow: `.github/workflows/ope-promotion-gate.yml`
6. Tests:
   - `src/lib/contracts/opeReport.test.ts`
   - `src/lib/ope/offPolicyEvaluation.test.ts`

## Estimator and exclusions

Policy version:

`ope-snips-v1`

Estimator:

1. Baseline value: mean observed attempt task score (normalized `0..1`) on complete rows.
2. Target policy: deterministic greedy action from `preActionScores` over `candidateActionSet`.
3. OPE value: SNIPS (`self-normalized inverse propensity`) on rows where logged action matches target action.
4. Lift: `targetPolicyValue - baselineValue`.
5. Confidence bounds: bootstrap percentile CI on lift.

Incomplete rows are excluded automatically with reasoned counters, including:

1. missing linkage/attempt rows
2. missing candidate actions or score maps
3. invalid propensity
4. missing/invalid chosen action linkage
5. missing task score outcome

## Artifact surfaces

API:

`GET /api/quality/ope?windowDays=90&limit=10000&bootstrapSamples=400`

Script:

`npx tsx src/scripts/ch21_ope_report.ts --window-days 90 --output docs/reports/CH21_OPE_REPORT.json`

Promotion gate:

`.github/workflows/ope-promotion-gate.yml` runs OPE script with configurable thresholds and uploads `CH21_OPE_REPORT.json` as CI artifact.

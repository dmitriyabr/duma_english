# CH-34 — Discourse/Pragmatics Engine v1

Last updated: 2026-02-18

## Goal

Add discourse/pragmatics rubric dimensions to evaluator outputs and publish an adjudicated quality benchmark.

Execution-board DoD:
1. Rubric dimensions added for argument structure, register, turn-taking/repair, cohesion, audience fit.
2. Evaluator outputs include these dimensions in task artifacts and rubric checks.
3. Artifact provides adjudicated quality benchmark.

## Implemented Components

1. Discourse engine module:
   - `src/lib/discourse/pragmatics.ts`
   - `src/lib/discourse/pragmatics.test.ts`
2. Evaluator integration:
   - `src/lib/evaluator.ts`
   - `src/lib/evaluator.test.ts`
3. Attempts API exposure (visible metrics + discourse payload fields):
   - `src/app/api/attempts/[id]/route.ts`
4. Benchmark contract + quality aggregator:
   - `src/lib/contracts/discoursePragmaticsBenchmarkReport.ts`
   - `src/lib/contracts/discoursePragmaticsBenchmarkReport.test.ts`
   - `src/lib/quality/discoursePragmaticsBenchmarkReport.ts`
   - `src/lib/quality/discoursePragmaticsBenchmarkReport.test.ts`
5. Benchmark API + script:
   - `GET /api/quality/discourse-pragmatics-benchmark`
   - `src/app/api/quality/discourse-pragmatics-benchmark/route.ts`
   - `src/scripts/ch34_discourse_pragmatics_benchmark_report.ts`

## Runtime Protocol

Protocol version:

`discourse-pragmatics-v1`

### Dimensions

1. `argumentStructure`
2. `registerControl`
3. `turnTakingRepair`
4. `cohesion`
5. `audienceFit`

Each dimension is scored `0..100`, thresholded at `>=65`, and exported both as:
1. `taskEvaluation.artifacts.discoursePragmatics`
2. explicit rubric checks (`argument_structure`, `register_control`, `turn_taking_repair`, `cohesion`, `audience_fit`)

Compatibility fields are also filled in artifacts for existing consumers:
1. `argumentScore`
2. `registerScore`
3. `coherenceScore`
4. `turnTakingScore`
5. `audienceFitScore`

## Adjudicated Benchmark

Contract version:

`discourse-pragmatics-benchmark-v1`

API:

`GET /api/quality/discourse-pragmatics-benchmark?windowDays=30&limit=20000`

Benchmark computes per-dimension:
1. engine pass-rate
2. adjudicated pass-rate
3. pass/fail agreement rate
4. MAE between engine and adjudicated score

and by-task-type agreement aggregates for discourse families.

Script:

`npx tsx src/scripts/ch34_discourse_pragmatics_benchmark_report.ts --window-days 30 --limit 20000 --output docs/reports/CH34_DISCOURSE_PRAGMATICS_BENCHMARK_REPORT.json`

Local artifact snapshot:
- `totalAttempts=181`
- `discourseAttempts=98`
- `engineCoverageCount=0`
- `overallAgreementRate=0.995918`

## Invariants Preserved

1. Additive-only changes: no schema breakage in existing task evaluation contract.
2. Existing score artifacts (`argumentScore`, `registerScore`, `coherenceScore`) remain supported.
3. Worker/runtime flow remains unchanged; CH-34 enriches evaluator outputs and observability.

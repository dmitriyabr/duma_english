# CH-36 - Reading runtime + assessment pipeline

## Objective
Add a dedicated reading task/evaluation/evidence loop that is integrated into the existing mastery graph and observable via quality metrics.

## What Landed

### 1) Reading task family in runtime planning
- Added `reading_comprehension` family to runtime task surfaces:
  - `src/lib/taskTemplates.ts`
  - `src/lib/taskGenerator.ts`
  - `src/lib/adaptive.ts`
  - `src/app/api/task/next/route.ts`
  - `src/app/api/planner/simulate/route.ts`
  - `src/app/api/learning-path/route.ts`
- Generator quality guardrails now enforce `Passage:` + `Question:` format for reading prompts.

### 2) Dedicated reading assessment contour
- Added reading assessment runtime module:
  - `src/lib/reading/assessment.ts` (`reading-assessment-v1`)
- Assessment computes reading-specific dimensions:
  - `questionAddressing`
  - `sourceGrounding`
  - `detailCoverage`
  - `overall`
- Evaluator integration (`src/lib/evaluator.ts`):
  - deterministic reading task evaluation path,
  - reading artifacts attached for both model and fallback paths,
  - reading rubric checks merged into `taskEvaluation.rubricChecks`,
  - reading feedback override when reading artifacts are present.

### 3) Reading observability + report artifact
- Added contract: `src/lib/contracts/readingRuntimeReport.ts`
- Added quality aggregator: `src/lib/quality/readingRuntimeReport.ts`
- Added quality API endpoint: `GET /api/quality/reading-runtime`
- Added report script: `src/scripts/ch36_reading_runtime_report.ts`
  - npm alias: `npm run reading-runtime:report`
  - default output: `docs/reports/CH36_READING_RUNTIME_REPORT.json`

### 4) Student-facing and attempt API surfacing
- Task UI adds reading-specific action copy (`src/app/task/page.tsx`).
- Attempt API now exposes reading score dimensions in metrics payload (`src/app/api/attempts/[id]/route.ts`).

## Artifact
- `docs/reports/CH36_READING_RUNTIME_REPORT.json`

## Validation
- `npm test -- src/lib/taskText.test.ts src/lib/reading/assessment.test.ts src/lib/evaluator.test.ts src/lib/taskGenerator.test.ts src/lib/contracts/readingRuntimeReport.test.ts src/lib/quality/readingRuntimeReport.test.ts`
- `npm run reading-runtime:report -- --window-days 30 --output docs/reports/CH36_READING_RUNTIME_REPORT.json`
- `npm run lint`
- `npm run build`

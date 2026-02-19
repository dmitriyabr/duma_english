# CH-37 - Writing runtime + assessment pipeline

## Objective
Ship a production writing contour with text submission UX, rubric-based evaluation, evidence/mastery updates, and quality telemetry dashboard for writing progression.

## What Landed

### 1) Writing runtime in task selection
- Added `writing_prompt` family into runtime planner/task catalogs:
  - `src/lib/taskTemplates.ts`
  - `src/lib/taskGenerator.ts`
  - `src/lib/gse/planner.ts`
  - `src/lib/adaptive.ts`
  - `src/lib/causal/ambiguityTrigger.ts`
  - `src/lib/ood/generator.ts`
  - `src/lib/ood/difficultyCalibration.ts`
- `task/next` now emits `assessmentMode="text"` for writing tasks:
  - `src/app/api/task/next/route.ts`

### 2) Child writing UX + rewrite loop
- Added dedicated writing page with draft + submit flow:
  - `src/app/write/page.tsx`
- `task` page routes text tasks to `/write`:
  - `src/app/task/page.tsx`
- `results` page now adapts copy/actions for writing attempts and supports rewrite CTA (`/write?revise=1`):
  - `src/app/results/page.tsx`
- `record` page now blocks writing tasks and redirects learner to writing flow:
  - `src/app/record/page.tsx`

### 3) Text submission API + worker text branch
- Added text submission endpoint:
  - `POST /api/attempts/text`
  - `src/app/api/attempts/text/route.ts`
- Audio route now rejects text-mode tasks:
  - `src/app/api/attempts/route.ts`
- Worker now supports text attempt processing path while preserving existing causal/evidence/mastery/reward/self-repair loops:
  - `src/worker/index.ts`
- Added deterministic writing metric derivation helper:
  - `src/lib/writing/textMetrics.ts`
- Attempt details API now includes task metadata (taskId/type/prompt/assessmentMode) for rewrite UX:
  - `src/app/api/attempts/[id]/route.ts`

### 4) Writing evaluation and scoring
- Added deterministic writing evaluator branch (`writing_prompt`) with rubric checks/artifacts:
  - `src/lib/evaluator.ts`
- Added writing-modality scoring path (task+language weighted overall without speech dependency):
  - `src/lib/scoring.ts`

### 5) Writing progression quality stack
- Contract:
  - `src/lib/contracts/writingProgressionDashboard.ts`
- Quality aggregator:
  - `src/lib/quality/writingProgressionDashboard.ts`
- Quality API:
  - `GET /api/quality/writing-progression`
  - `src/app/api/quality/writing-progression/route.ts`
- Report script:
  - `src/scripts/ch37_writing_progression_dashboard_report.ts`
  - npm alias: `npm run writing:progression:report`
- Artifact:
  - `docs/reports/CH37_WRITING_PROGRESSION_DASHBOARD.json`

## Validation
- `npm test -- src/lib/evaluator.test.ts src/lib/taskGenerator.test.ts src/lib/scoring.test.ts src/lib/contracts/writingProgressionDashboard.test.ts src/lib/quality/writingProgressionDashboard.test.ts src/lib/ood/difficultyCalibration.test.ts`
- `npm run writing:progression:report -- --window-days 30 --output docs/reports/CH37_WRITING_PROGRESSION_DASHBOARD.json`
- `npm run lint`
- `npm run build`

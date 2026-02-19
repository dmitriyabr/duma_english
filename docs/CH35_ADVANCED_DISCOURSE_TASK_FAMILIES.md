# CH-35 — Advanced Discourse Task Families

Last updated: 2026-02-19

## Goal

Extend the task catalog and runtime selection so C1/C2 learners receive advanced discourse families:
1. `argumentation`
2. `register_switch`
3. `misunderstanding_repair`

Execution-board DoD:
1. Task generator supports C1/C2 families for argumentation, register switching, and misunderstanding repair.
2. Artifact provides task catalog diff and pass-rate by task family.

## Implemented Components

1. Task catalog + fallback generation:
   - `src/lib/taskTemplates.ts`
   - `src/lib/taskGenerator.ts`
   - `src/lib/taskGenerator.test.ts`
2. Stage-aware runtime routing and planning:
   - `src/app/api/task/next/route.ts`
   - `src/lib/gse/planner.ts`
   - `src/app/api/planner/simulate/route.ts`
   - `src/lib/adaptive.ts`
   - `src/app/api/learning-path/route.ts`
3. Policy/auxiliary compatibility:
   - `src/lib/causal/ambiguityTrigger.ts`
   - `src/lib/selfRepair/delayedVerification.ts`
   - `src/lib/ood/generator.ts`
   - `src/lib/ood/difficultyCalibration.ts`
4. Coverage contract alignment for C1/C2:
   - `src/lib/contracts/cefrCoverageMatrix.ts`
   - `src/lib/contracts/cefrCoverageMatrix.test.ts`
5. CH-35 report stack (catalog diff + pass-rate):
   - `src/lib/contracts/advancedDiscourseTaskFamiliesReport.ts`
   - `src/lib/contracts/advancedDiscourseTaskFamiliesReport.test.ts`
   - `src/lib/quality/advancedDiscourseTaskFamiliesReport.ts`
   - `src/lib/quality/advancedDiscourseTaskFamiliesReport.test.ts`
   - `GET /api/quality/advanced-discourse-task-families`
   - `src/app/api/quality/advanced-discourse-task-families/route.ts`
   - `src/scripts/ch35_advanced_discourse_task_families_report.ts`

## Runtime Notes

1. Advanced families are stage-gated to `C1/C2` in planner/task-next defaults.
2. Existing lower-stage families remain unchanged for `A0..B2`.
3. Discourse/pragmatics family detection includes the three new advanced task types.

## Artifact

Generated report:

`docs/reports/CH35_ADVANCED_DISCOURSE_TASK_FAMILIES_REPORT.json`

Includes:
1. baseline vs current task catalog diff (`addedTaskFamilies`, `removedTaskFamilies`)
2. catalog metadata per family (classification, stage coverage, discourse support)
3. pass-rate table by task family over selected window

Script:

`npx tsx src/scripts/ch35_advanced_discourse_task_families_report.ts --window-days 30 --limit 20000 --output docs/reports/CH35_ADVANCED_DISCOURSE_TASK_FAMILIES_REPORT.json`

## Validation

1. Targeted tests: PASS (`28/28`) for updated and new CH-35 modules.
2. `npm run lint`: PASS.
3. `npm run build`: blocked by unrelated `/write` suspense-boundary issue in parallel CH-37 scope.

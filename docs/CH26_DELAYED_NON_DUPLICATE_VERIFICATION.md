# CH-26 Delayed Non-Duplicate Verification

Last updated: 2026-02-18

## Goal

Make delayed verification mandatory after immediate self-repair and enforce non-duplicate checks:

1. Verification must use a different task family than source/immediate retry.
2. Verification prompt formulation must be materially different.

Execution-board DoD:
1. Delayed verification is mandatory.
2. Verification cannot be a duplicate by family/formulation.
3. Artifact provides duplicate-check validator + invalid-verification counter.

## Implemented components

1. Runtime module: `src/lib/selfRepair/delayedVerification.ts`
2. Task-next integration (delayed verification routing + cycle linkage):
   - `src/app/api/task/next/route.ts`
3. Worker integration (completion + duplicate validation + status update):
   - `src/worker/index.ts`
4. Report contract + quality aggregator:
   - `src/lib/contracts/selfRepairDelayedVerificationReport.ts`
   - `src/lib/quality/selfRepairDelayedVerificationReport.ts`
5. Quality API endpoint:
   - `src/app/api/quality/self-repair-delayed-verification/route.ts`
6. Report script:
   - `src/scripts/ch26_self_repair_delayed_verification_report.ts`
7. Tests:
   - `src/lib/selfRepair/delayedVerification.test.ts`
   - `src/lib/contracts/selfRepairDelayedVerificationReport.test.ts`
   - `src/lib/quality/selfRepairDelayedVerificationReport.test.ts`

## Runtime protocol

Protocol version:

`self-repair-delayed-verification-v1`

### Scheduling

1. `task-next` checks pending cycles in `pending_delayed_verification` state.
2. It enforces delayed verification before normal flow.
3. It chooses a different task family via `selectDelayedVerificationTaskType`.
4. It rewrites prompt framing through `buildDelayedVerificationPrompt` to avoid duplicate wording.
5. It links `delayedVerificationTaskInstanceId` back to `SelfRepairCycle`.

### Completion

1. Worker detects `taskMeta.selfRepair.mode=delayed_verification`.
2. It validates family/formulation via `validateDelayedVerificationNonDuplicate`.
3. It stores validation trace in cycle metadata and updates status:
   - `completed` if valid.
   - `escalated` if duplicate/invalid.

## Duplicate-check validator

`validateDelayedVerificationNonDuplicate` enforces:

1. Different task family (`duplicate_task_family` violation).
2. Prompt similarity below threshold (`duplicate_prompt_formulation` violation).
3. Required context fields (`missing_task_family_context`, `missing_prompt_context`).

## Artifact surface

API:

`GET /api/quality/self-repair-delayed-verification?windowDays=30&limit=5000&staleThresholdHours=72`

Main counters:

1. `invalidVerificationCount`
2. `invalidDuplicateTaskFamilyCount`
3. `invalidDuplicatePromptCount`
4. `missingDelayedVerificationCount`
5. `invalidRate`
6. `reasonCounts`

Script:

`npx tsx src/scripts/ch26_self_repair_delayed_verification_report.ts --window-days 30 --stale-threshold-hours 72 --output docs/reports/CH26_SELF_REPAIR_DELAYED_VERIFICATION_REPORT.json`


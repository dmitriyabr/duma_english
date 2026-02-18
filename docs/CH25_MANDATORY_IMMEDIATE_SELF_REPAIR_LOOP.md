# CH-25 Mandatory Immediate Self-Repair Loop

Last updated: 2026-02-18

## Goal

Enforce an immediate corrected retry after low-quality attempts, and track completion via `SelfRepairCycle` records.

Execution-board DoD:
1. Immediate self-repair retry is mandatory in normal flow after causal feedback.
2. Artifact exposes `SelfRepairCycle` completion-rate metric.

## Implemented components

1. Self-repair runtime module: `src/lib/selfRepair/immediateLoop.ts`
2. Worker integration: `src/worker/index.ts`
3. Task-next integration for mandatory immediate retry routing: `src/app/api/task/next/route.ts`
4. Report contract + quality aggregator:
   - `src/lib/contracts/selfRepairImmediateLoopReport.ts`
   - `src/lib/quality/selfRepairImmediateLoopReport.ts`
5. Quality API endpoint: `src/app/api/quality/self-repair-immediate-loop/route.ts`
6. Report script: `src/scripts/ch25_self_repair_immediate_loop_report.ts`
7. Tests:
   - `src/lib/selfRepair/immediateLoop.test.ts`
   - `src/lib/contracts/selfRepairImmediateLoopReport.test.ts`
   - `src/lib/quality/selfRepairImmediateLoopReport.test.ts`

## Runtime protocol (v1)

Protocol version:

`self-repair-immediate-v1`

Trigger:
1. Completed non-read-aloud attempt with `taskScore < 70`.
2. Attempt is not already marked as immediate self-repair retry.

Worker actions:
1. Create `SelfRepairCycle(status=pending_immediate_retry)` linked to source attempt.
2. Persist source context in cycle metadata (task type, prompt, source target nodes, cause label).

Task-next actions:
1. If open `pending_immediate_retry` cycle exists, enforce immediate retry task type.
2. Build corrected prompt with causal/feedback hint (`buildImmediateSelfRepairPrompt`).
3. Mark task meta with `selfRepair.mode=immediate_retry` + cycle linkage.

Completion:
1. When immediate retry attempt is processed, worker sets:
   - `immediateAttemptId`
   - `status=pending_delayed_verification`
2. Completion is tracked as immediate-loop completion for CH-25 metric.

## Artifact surface

API:

`GET /api/quality/self-repair-immediate-loop?windowDays=30&limit=5000`

Main metrics:
1. `immediateCompletedCount`
2. `immediateCompletionRate`
3. status breakdown (`pending_immediate_retry`, `pending_delayed_verification`, `completed`, `escalated`, `cancelled`)
4. `medianImmediateLatencyMinutes`
5. cause label distribution

Script:

`npx tsx src/scripts/ch25_self_repair_immediate_loop_report.ts --window-days 30 --output docs/reports/CH25_SELF_REPAIR_IMMEDIATE_LOOP_REPORT.json`

# CH-17 Milestone Multi-Axis Stress Gates

## Goal

Require milestone promotion readiness to pass a multi-axis OOD stress set with a worst-case floor (not average-only).

Execution-board DoD:
1. Milestone promotion depends on multi-axis stress-set pass.
2. Promotion audit contains stress-gate details.

## Runtime Design

### Stress gate evaluator
- `src/lib/ood/stressGate.ts`

Protocol:
1. Active for milestone targets `>= B1`.
2. Uses recent OOD probes (default 45-day window).
3. Multi-axis evidence is derived from pairwise axis combinations (e.g. `topic+register`).
4. Stress set requires at least 2 distinct pairwise combinations.
5. Pass uses worst-case floor (`oodTaskScore >= 70`) on the selected stress set.
6. If any selected pair is failed/inconclusive, gate fails.

Output trace includes:
1. Required/evaluated/passed flags.
2. Pair coverage counters and selected stress-set pairs.
3. Worst-case score and reason codes.
4. Pair-level observations for auditability.

### Stage projection and promotion readiness
- `src/lib/gse/stageProjection.ts`

Integration:
1. `projectLearnerStageFromGse` now evaluates `stressGate` for `targetStage`.
2. `promotionReady` is true only when bundle gate is ready and stress gate passes.
3. If bundle gate is ready but stress gate fails, synthetic blocker `stress_gate_not_passed` is added into `blockedBundles`.
4. Stage projection output now includes `stressGate`.

### Promotion audit trace
Stress-gate details are now persisted in promotion audit context:
1. `src/lib/placement.ts` -> `PromotionAudit.reasonsJson.stressGate`
2. `src/lib/adaptive.ts` -> `PromotionAudit.reasonsJson.stressGate`
3. `src/lib/gse/stageProjection.ts` -> learner/profile projection evidence payloads include `stressGate`

### Progress API visibility
- `src/lib/progress.ts`

`promotionReadiness.stressGate` is exposed in progress payload and readable blocker reason maps `stress_gate_not_passed`.

## Tests

- `src/lib/ood/stressGate.test.ts`

Covered:
1. Gate disabled below milestone floor.
2. Pass on 2 pairwise multi-axis passes with worst-case floor satisfied.
3. Fail on validated transfer fail.
4. Fail on insufficient pairwise coverage.
5. Most recent pair observation wins when duplicates exist.


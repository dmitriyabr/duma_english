# CH-10 Ambiguity Trigger Logic

## Goal

Enable disambiguation probes only when two conditions hold:
1. Causal posterior is ambiguous.
2. Action choice is materially unstable.

This follows blueprint section 5.5 (`entropy/margin/action-instability`) and prevents unnecessary over-diagnosis.

## Runtime logic

Source:
- `src/lib/causal/ambiguityTrigger.ts`

Planner integration:
- `src/lib/gse/planner.ts`
- `src/app/api/task/next/route.ts`
- `src/app/api/planner/simulate/route.ts`

Current thresholds:
- `entropyMax = 0.62`
- `marginMin = 0.16`
- `deltaActionValue = 0.24`

Decision flow:
1. Read latest `CausalDiagnosis` snapshot.
2. Mark posterior ambiguous when `entropy > entropyMax` OR `topMargin < marginMin`.
3. Map top-2 causes to policy action families.
4. Compute best utility by action family from planner candidate set.
5. Mark material instability only if top-2 cause action families differ and utility gap is `>= deltaActionValue`.
6. Trigger disambiguation only if the diagnostic probe candidate would change the chosen task.

## Traceability

Planner writes ambiguity trigger details into `PlannerDecisionLog.utilityJson`:
- trigger booleans (`posteriorAmbiguous`, `materialInstability`, `shouldTrigger`, `triggered`, `applied`),
- reason codes,
- thresholds and metrics,
- top cause labels/action families,
- recommended probe candidate.

Task response now includes `causalAmbiguityTrigger` payload for runtime diagnostics.

## Tests

Trigger matrix tests:
- `src/lib/causal/ambiguityTrigger.test.ts`

Covered scenarios:
- no causal snapshot,
- ambiguous posterior + material instability -> trigger,
- trigger suppressed when probe already selected,
- high-confidence posterior blocks trigger even with large action gap.

# CH-23 Guardrailed Hybrid Selector

## Goal

Select the next action through a guardrailed hybrid policy:

1. Apply non-bypassable hard constraints.
2. Blend rule utility with learned value signal.
3. Keep a non-zero exploration floor.

## Policy

- `policyVersion`: `policy-hybrid-guardrailed-v1`
- Selector module: `src/lib/policy/hybridSelector.ts`
- Planner integration: `src/lib/gse/planner.ts`

### Inputs

Each candidate action is scored with:

- `ruleUtility` from rule/cause-adjusted planner scoring.
- `learnedValue` from shadow value model (`CH-22`) when available.
- `hardConstraintReasons` mask:
  - target nodes required
  - diversity rotation streak guards
  - verification SLA guard
  - safety guards (`low_success_probability`, `high_engagement_risk`, `high_latency_risk`)

### Selection

1. Filter to feasible actions (no hard-constraint reasons).
2. Compute blended pre-action score (`ruleWeight`, `learnedWeight`).
3. Convert scores to propensities with softmax temperature.
4. Apply exploration floor to every feasible action.
5. Choose deterministic top propensity (stable tie-break).

If all actions are constrained, selector falls back to deterministic rule-utility choice and marks `hard_constraint_fallback`.

## Decision Trace Artifact

Planner now writes hybrid trace in `PlannerDecisionLog.utilityJson`:

- `policyVersion`
- `propensity` (chosen action)
- `candidateActionSet`
- `preActionScores`
- `activeConstraints`
- `constraintMask`
- `hybridPolicy` (full selector trace)

This satisfies CH-23 artifact requirement: decision trace includes constraint mask and propensity.

## Validation

- `npx tsx --test src/lib/policy/hybridSelector.test.ts`
- `npm run lint`
- `npm run build`


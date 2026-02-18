# CH-12 Cause-Driven Remediation Policy Rules

## Goal

Implement policy behavior where causal class changes action strategy selection, instead of relying only on generic weakness/retry utility.

Execution-board DoD:
1. Policy selects different strategy by cause class.
2. Decision trace shows how cause affected action choice.

## Runtime Integration

### Policy module
- `src/lib/causal/remediationPolicy.ts`

The module computes:
1. Normalized cause weights from causal snapshot distribution.
2. Cause -> action-family utility offsets (`diagnostic_probe`, `targeted_practice`, `transfer_probe`).
3. Confidence scaling from entropy/top-margin so high-ambiguity posteriors soften offsets.
4. Per-task-type utility adjustment + alignment tags (`preferred/neutral/discouraged`).

### Planner integration
- `src/lib/gse/planner.ts`

Planner flow now:
1. Compute base candidate utility.
2. Apply cause-driven adjustment per task type.
3. Sort by adjusted utility for top-choice policy selection.
4. Keep trace in `PlannerDecisionLog.utilityJson.causalRemediation` and return it in planner decision payload.

Trace includes:
1. Top cause/probability, entropy/topMargin, confidence scale.
2. Action-family score table and recommended/discouraged families.
3. Per-choice adjustment/alignment and whether policy changed top choice vs base utility.

### API exposure
- `src/app/api/task/next/route.ts`
- `src/app/api/planner/simulate/route.ts`

Added `causalRemediation` payload to task-next and planner-simulate responses, and persisted it in task meta for auditability.

## Tests

- `src/lib/causal/remediationPolicy.test.ts`

Coverage:
1. No snapshot => zero adjustments.
2. `rule_confusion` prioritizes targeted practice and discourages transfer probe.
3. `l1_interference` prioritizes transfer probe and suppresses diagnostics.
4. High ambiguity reduces adjustment magnitude (confidence softening).


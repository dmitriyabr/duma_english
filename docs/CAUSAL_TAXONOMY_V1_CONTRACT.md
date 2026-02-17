# CH-07 Causal Taxonomy v1 Contract

Last updated: 2026-02-17

## Canonical Labels

`causal-taxonomy-v1` uses exactly these labels:

1. `rule_confusion`
2. `l1_interference`
3. `retrieval_failure`
4. `instruction_misread`
5. `attention_loss`
6. `production_constraint`
7. `mixed`
8. `unknown`

## JSON Contract

Primary schema is `causalDiagnosisContractSchema` in `src/lib/db/types.ts`.

Contract requirements:

1. `taxonomyVersion` is fixed to `causal-taxonomy-v1`.
2. `topLabel` and `distribution[].label` are normalized to canonical labels.
3. `distribution[].p` is a probability in `[0,1]`.
4. `confidenceInterval` keeps invariant `lower <= upper`.

## Backward Compatibility Adapter

Function: `adaptLegacyCausalDiagnosisPayload(input)` in `src/lib/db/types.ts`.

Adapter behavior:

1. Maps legacy label tokens to canonical labels (for example `grammar_error -> rule_confusion`, `memory_lapse -> retrieval_failure`, `multi_cause -> mixed`).
2. Accepts legacy probability formats (`0..1` and `0..100`) and normalizes to `[0,1]`.
3. Accepts legacy field names (`topCause`, `topP`, `causes`, `causeDistribution`, `model`) and outputs schema-valid v1 payload.
4. Falls back to `unknown` for unmapped labels.

## Validation Artifact

Tests:

1. `src/lib/db/types.test.ts` validates v1 payload parsing.
2. `src/lib/db/types.test.ts` validates label normalization and legacy adapter upgrade flow.

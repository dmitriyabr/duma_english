# BRAIN RUNTIME (Current)

Last updated: 2026-02-07

## Core Loop
1. Planner chooses `targetNodeIds` from GSE mastery deficits + uncertainty + overdue.
2. Task generator creates task spec for those nodes.
3. Attempt is analyzed (speech + task + grammar checks).
4. Semantic LO/Grammar matching runs:
- parser LLM extracts intents/patterns from transcript.
- embedding retrieval ranks `GSE_LO`/`GSE_GRAMMAR` candidates in stage/audience window.
- evaluation LLM receives only these options and returns structured checks.
5. Evidence rows are written (`AttemptGseEvidence`).
5. Mastery posterior is updated (`StudentGseMastery`).
6. Stage projections are recalculated:
- `placementStage` (provisional)
- `promotionStage` (bundle-gated)

## Evidence Policy
1. Domains: `vocab`, `grammar`, `lo`.
2. Evidence kinds: `direct`, `supporting`, `negative`.
3. Opportunity types: `explicit_target`, `elicited_incidental`, `incidental`.
4. Promotion uses verified/direct signals, not incidental-only.
5. Semantic incidental signals (`openai` source) are stored as `targeted=false` and do not promote stage directly.

## Node Lifecycle
1. `observed`: incidental signals noticed.
2. `candidate_for_verification`: enough incidental confidence across task types.
3. `verified`: explicit-target direct pass threshold reached.

## Key Invariants
1. No legacy skill-average path in decision loop.
2. No promotion by read-aloud lexical evidence.
3. No next task without node targets.
4. Explainability is emitted per decision and attempt.
5. LLM never evaluates against full catalog; only against retrieval shortlist + explicit task targets.

# DEBUG PLAYBOOK (Brain)

Last updated: 2026-02-07

## A) Why score/progress looks wrong for one attempt
Inspect:
1. `Attempt.taskEvaluationJson`
2. `Attempt.nodeOutcomesJson`
3. `AttemptGseEvidence` rows for attempt
4. `TaskInstance.targetNodeIds`
5. linked `PlannerDecisionLog`

Expected chain:
`target nodes -> task prompt -> checks -> evidence -> mastery update`

If chain is broken, fix at the earliest broken link.

## B) Why strong extra language was not credited
Check:
1. alias coverage exists for words/phrases in transcript.
2. incidental evidence rows were written (`targeted=false`).
3. activation state moved (`observed` or `candidate_for_verification`).
4. planner scheduled verification tasks.

## C) Why stage did not move
Check:
1. `promotionStage` blockers (bundle/node labels).
2. verified coverage by domain.
3. reliability and stability gates.
4. direct evidence counts.

## D) Mandatory checks before saying “fixed”
1. `npm test`
2. `npm run lint`
3. `npm run build`
4. Re-run one real attempt and inspect evidence + node outcomes.

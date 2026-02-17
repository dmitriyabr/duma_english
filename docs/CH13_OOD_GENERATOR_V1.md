# CH-13 OOD Generator v1

Last updated: 2026-02-17

## Scope

CH-13 introduces the first production OOD generator with explicit axis tags.

Core implementation files:

1. `src/lib/ood/generator.ts`
2. `src/app/api/task/next/route.ts`

## Generation Rules (v1)

1. OOD tasks are injected on deterministic cadence: every 6th generated task per learner.
2. Each injected task receives explicit `axisTags` from canonical axes:
   - `topic`
   - `register`
   - `interlocutor`
   - `goal`
   - `format`
3. `role_play` and `topic_talk` receive two-axis tags (primary + secondary); other task families receive one axis.

## Persistence Contract

When OOD is injected, `task/next` creates an `OODTaskSpec` row with:

1. `studentId`
2. `taskInstanceId`
3. `decisionLogId`
4. `axisTags`
5. `difficultyAnchor`
6. `inDomainDifficulty`
7. `difficultyDelta` (initially `0`)
8. `status=planned`
9. generator metadata (`generatorVersion=ood-generator-v1`, `taskOrdinal`, `interval`)

## API Exposure

`GET /api/task/next` now returns additive field:

`oodTaskSpec: { id, axisTags, status, difficultyAnchor, createdAt } | null`

This allows runtime/debug surfaces to track OOD generation immediately after task assignment.

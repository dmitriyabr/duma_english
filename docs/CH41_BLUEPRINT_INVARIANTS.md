# CH-41 - Regression suites for blueprint invariants

## Objective
Add a regression test pack that encodes non-negotiable blueprint invariants (causal quality, transfer, retention, retry precision, policy/reward versioning). Any failure must block release. Pack runs in CI.

## What Landed

### 1) Invariant test pack
- File: `src/lib/invariants/blueprintInvariants.test.ts`
- Tests:
  - **Causal**: taxonomy includes `mixed` and `unknown`; diagnosis contract requires `modelVersion` and valid `topLabel`.
  - **Retry**: `needs_retry` is the only retry status; `isAttemptRetryStatus` behaviour (worker must not mutate mastery for needs_retry).
  - **Reward**: reward is versioned (`REWARD_FUNCTION_VERSION_V1`).
  - **Policy**: policy decisions carry `policyVersion`; PolicyDecisionLogV2 contract requires `policyVersion`.
  - **Planner**: `PlannerDecision` has `targetNodeIds` (no task without node targets).
  - **Transfer**: transfer verdict protocol is versioned.
  - **Retention**: retention probes use 7/30/90 windows; protocol versioned.
  - **Causal taxonomy**: fixed version constant.

### 2) npm script and CI
- Script: `npm run test:invariants` — runs only `src/lib/invariants/blueprintInvariants.test.ts`.
- Workflow: `.github/workflows/blueprint-invariants.yml` — runs on PR and push to `main` / `codex/autopilot-execution-plan`; runs `npm run test:invariants`.

## Validation
- `npm run test:invariants`
- `npm test` (invariant tests are part of full suite)
- `npm run lint`
- `npm run build`

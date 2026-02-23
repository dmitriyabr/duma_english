# FX-12 Rollout, Observability, Guardrails

Last updated: 2026-02-23

## Feature Flags

Runtime flags are read from env vars (either direct or `FF_` prefixed):

1. `LISTENING_RUNTIME_V2` (`FF_LISTENING_RUNTIME_V2`)
2. `RETENTION_GATE_V2` (`FF_RETENTION_GATE_V2`)
3. `MEMORY_RUNTIME_V1` (`FF_MEMORY_RUNTIME_V1`)
4. `POLICY_GATE_V1` (`FF_POLICY_GATE_V1`)
5. `SHADOW_MODEL_V2` (`FF_SHADOW_MODEL_V2`)

Accepted values: `true/false`, `1/0`, `on/off`, `yes/no`.

## Rollback Procedure

### 1) `listening_runtime_v2`

- Rollback switch: `LISTENING_RUNTIME_V2=false`
- Effect:
  - `GET /api/task/next` stops issuing `listening` payload.
  - Listening task goes through legacy prompt path.
- Verify:
  - New listening tasks in `/api/task/next` have no `listening` object.
  - `/api/quality/runtime-rollout` shows `flags.listening_runtime_v2=false`.

### 2) `retention_gate_v2`

- Rollback switch: `RETENTION_GATE_V2=false`
- Effect:
  - Promotion gate returns to legacy hard retention blocking.
  - `retentionOperational` and `retentionCertification` still computed for observability.
- Verify:
  - `promotionReady` can be blocked by retention in stage projection.
  - `/api/quality/runtime-rollout` shows `flags.retention_gate_v2=false`.

### 3) `memory_runtime_v1`

- Rollback switch: `MEMORY_RUNTIME_V1=false`
- Effect:
  - Memory scheduler sync is disabled in `task/next`.
  - Planner ignores due memory queue when choosing next task.
- Verify:
  - `task/next` response keeps `memoryQueueHits=0`.
  - `/api/quality/runtime-rollout` shows `flags.memory_runtime_v1=false`.

### 4) `policy_gate_v1`

- Rollback switch: `POLICY_GATE_V1=false`
- Effect:
  - Promotion audits stop enforcing/including automatic policy readiness gate.
  - Existing audits remain in history for analysis.
- Verify:
  - New promotion audits carry `policyGate: null`.
  - `/api/quality/runtime-rollout` shows `flags.policy_gate_v1=false`.

### 5) `shadow_model_v2`

- Rollback switch: `SHADOW_MODEL_V2=false`
- Effect:
  - Shadow scorer falls back to legacy static linear weights.
  - Snapshot DB loading is bypassed for runtime decisions.
- Verify:
  - Shadow trace `modelVersion` prefix is `shadow-linear-contextual-v1`.
  - `/api/quality/runtime-rollout` shows `flags.shadow_model_v2=false`.

## Observability

Main dashboard endpoint:

- `GET /api/quality/runtime-rollout?windowDays=30&limit=20000`

Tracks:

1. Listening authenticity: payload coverage, prompt leakage, leakage rate.
2. Memory runtime: due-backlog hit-rate and override counts.
3. Causal coach exposure: completed attempts with causal diagnosis.
4. Promotion blockers by reason: blocked audits and reason distribution.

Offline artifact generation:

- `npm run runtime-rollout:report -- --windowDays 30 --output docs/reports/CH12_RUNTIME_ROLLOUT_DASHBOARD.json`

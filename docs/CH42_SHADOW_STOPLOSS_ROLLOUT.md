# CH-42 - Shadow-mode + stop-loss rollout automation

## Objective
New policy versions go through shadow, progressive ramp, and auto rollback on stop-loss. Rollout controller logs all decisions; rollback drills verify procedure.

## What Landed

### 1) Rollout state and log contract
- `src/lib/contracts/rolloutController.ts`:
  - `RolloutPhase`: shadow_only | ramp_5 | ramp_20 | ramp_50 | full | rolled_back
  - `RolloutState`: policyVersion, phase, updatedAt, reason?
  - `RolloutControllerLogEntry`: timestamp, policyVersion, phase, decision (hold | ramp_up | rollback), reason, metricsSnapshot?
- Contract test: `src/lib/contracts/rolloutController.test.ts`

### 2) Stop-loss controller
- `src/lib/rollout/controller.ts`:
  - `evaluateRolloutDecision({ currentState, windowDays?, now? })`: builds shadow, retention cohort, listening transfer reports; evaluates stop-loss thresholds; returns decision + reason + metricsSnapshot.
  - Stop-loss thresholds: shadow highRiskPer1k > 10 → rollback; retention overallPassRate < 0.5 (if ≥5 probes) → rollback; transfer passRate < 0.4 (if ≥3 evaluable) → rollback.
  - `createRolloutLogEntry(...)` for consistent log lines.

### 3) State and log persistence
- State file: `ROLLOUT_STATE_PATH` env or `docs/reports/CH42_ROLLOUT_STATE.json`.
- Log file: `ROLLOUT_CONTROLLER_LOG_PATH` env or `docs/reports/CH42_ROLLOUT_CONTROLLER_LOG.ndjson` (one JSON object per line).

### 4) Script and rollback drill
- `src/scripts/ch42_rollout_controller.ts`:
  - `--evaluate [--apply] [--window-days 7]`: load state, evaluate, append log; if `--apply` and decision is rollback, write state to rolled_back.
  - `--rollback-drill [--apply]`: append rollback_drill log entry; if `--apply`, set state to rolled_back (drill).
- npm script: `npm run rollout:controller -- --evaluate`

### 5) API
- `GET /api/quality/rollout-status`: returns current state (from file) + last 50 log entries (auth required).

## Artifacts
- `docs/reports/CH42_ROLLOUT_STATE.json` (created when state is written)
- `docs/reports/CH42_ROLLOUT_CONTROLLER_LOG.ndjson` (append-only controller log)

## Validation
- `npm test -- src/lib/contracts/rolloutController.test.ts`
- `npm run rollout:controller -- --evaluate --window-days 7`
- `npm run rollout:controller -- --rollback-drill` (dry run)
- `npm run lint`
- `npm run build`

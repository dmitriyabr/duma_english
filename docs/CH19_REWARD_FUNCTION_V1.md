# CH-19 Reward Function v1 (Versioned)

## Goal

Formalize a versioned composite reward and persist it into `RewardTrace` for policy learning/replay.

Execution-board DoD:
1. Reward formula is explicit: `mastery delta + transfer + retention - friction`.
2. Reward version is stored in trace.

## Implementation

### Versioned reward registry + evaluator
- `src/lib/reward/function.ts`

Added:
1. `REWARD_CONFIG_REGISTRY` with version `reward-composite-v1`.
2. Deterministic evaluator `evaluateCompositeReward(...)`.
3. Contract builder `buildRewardTraceContract(...)` validated by `rewardTraceContractSchema`.
4. Same-session persistence helper `upsertSameSessionRewardTrace(...)`.

Current v1 behavior:
1. **Mastery term:** scaled/clamped from attempt-level mastery delta.
2. **Transfer term:** verdict-driven reward from CH-15 transfer verdict (`transfer_pass`, `transfer_fail_validated`, etc.).
3. **Retention term:** versioned mapping by reward window (`same_session/day_7/day_30`).
4. **Friction penalty:** recovery-trigger/low-score/low-confidence penalties with cap.

### Runtime write-path
- `src/worker/index.ts`

After attempt evidence write:
1. Worker computes same-session reward signals (`masteryDeltaTotal`, transfer verdict, friction signals).
2. Worker upserts `RewardTrace` by unique key (`decisionLogId + rewardWindow + rewardVersion`).
3. Reward trace logging includes `rewardVersion`, `rewardWindow`, and `totalReward`.

This ensures each decision has versioned reward attribution for replay/OPE stages.

### Config registry report artifact
- `src/scripts/ch19_reward_config_registry_report.ts`
- `docs/reports/CH19_REWARD_CONFIG_REGISTRY_REPORT.json`

Script exports:
1. Current versioned reward config.
2. Deterministic replay sample.
3. Reproducibility hash comparison.

## Tests

- `src/lib/reward/function.test.ts`

Coverage:
1. Composite equation consistency.
2. RewardTrace contract compatibility for same-session writes.
3. Replay reproducibility test (same input => identical outputs/hash).


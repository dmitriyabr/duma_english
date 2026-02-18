# CH-04 Policy Decision Log v2 Contract

## Goal
Ensure every planner decision has a machine-valid v2 policy log contract with required fields:
- `policyVersion`
- `contextSnapshotId`
- `candidateActionSet`
- `preActionScores`
- `propensity`
- `activeConstraints`
- linkage fields: `linkageTaskId`, `linkageAttemptId`, `linkageSessionId`

## Data model
`PolicyDecisionLogV2` is a normalized v2 contract table linked to `PlannerDecisionLog`.

Sync is DB-driven (non-blocking for runtime):
1. Trigger on `PlannerDecisionLog` insert/update.
2. Trigger on `TaskInstance` insert/update.
3. Trigger on `Attempt` insert/update.
4. Backfill for existing decisions in migration.

Implementation source:
- Migration: `prisma/migrations/20260218010000_ch04_policy_decision_log_v2_contract/migration.sql`
- Prisma model: `prisma/schema.prisma`

## Validator
Contract schema:
- `src/lib/db/types.ts` (`policyDecisionLogV2ContractSchema`)

Validation script:
- `src/scripts/ch04_policy_decision_log_validator.ts`

Example:
```bash
npx tsx src/scripts/ch04_policy_decision_log_validator.ts \
  --window-days 30 \
  --limit 5000 \
  --max-invalid-rate 0.05 \
  --output docs/reports/CH04_POLICY_DECISION_LOG_DASHBOARD.json
```

## Invalid-log dashboard
API endpoint:
- `GET /api/quality/policy-decision-log?windowDays=30&limit=5000`

Response contains:
- total/valid/invalid logs
- `invalidRate`
- top invalid reasons
- policy version distribution

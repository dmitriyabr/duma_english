-- CH-02 data model v2 bootstrap seed.
-- Run manually after migrations when you need a baseline anchor-eval row for local/dev smoke checks:
--   psql "$DATABASE_URL" -f prisma/seeds/ch02_data_model_v2_seed.sql

INSERT INTO "AnchorEvalRun" (
  "id",
  "policyVersion",
  "rewardVersion",
  "datasetVersion",
  "status",
  "notes"
)
VALUES (
  'seed_anchor_eval_run_v1',
  'policy-bootstrap-v1',
  'reward-v1',
  'dataset-bootstrap-v1',
  'completed',
  'Bootstrap seed row for CH-02 data model v2 validation.'
)
ON CONFLICT ("id") DO NOTHING;

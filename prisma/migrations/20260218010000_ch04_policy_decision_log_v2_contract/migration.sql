-- CH-04: Policy decision log v2 contract + linkage materialization

CREATE TABLE "PolicyDecisionLogV2" (
    "id" TEXT NOT NULL,
    "decisionLogId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "contextSnapshotId" TEXT,
    "candidateActionSet" JSONB NOT NULL,
    "preActionScores" JSONB NOT NULL,
    "propensity" DOUBLE PRECISION,
    "activeConstraints" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "linkageTaskId" TEXT,
    "linkageAttemptId" TEXT,
    "linkageSessionId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'sql_trigger_v1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PolicyDecisionLogV2_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PolicyDecisionLogV2_decisionLogId_key" ON "PolicyDecisionLogV2"("decisionLogId");
CREATE INDEX "PolicyDecisionLogV2_studentId_createdAt_idx" ON "PolicyDecisionLogV2"("studentId", "createdAt");
CREATE INDEX "PolicyDecisionLogV2_policyVersion_createdAt_idx" ON "PolicyDecisionLogV2"("policyVersion", "createdAt");
CREATE INDEX "PolicyDecisionLogV2_linkageTaskId_createdAt_idx" ON "PolicyDecisionLogV2"("linkageTaskId", "createdAt");
CREATE INDEX "PolicyDecisionLogV2_linkageAttemptId_createdAt_idx" ON "PolicyDecisionLogV2"("linkageAttemptId", "createdAt");
CREATE INDEX "PolicyDecisionLogV2_contextSnapshotId_createdAt_idx" ON "PolicyDecisionLogV2"("contextSnapshotId", "createdAt");

ALTER TABLE "PolicyDecisionLogV2" ADD CONSTRAINT "PolicyDecisionLogV2_decisionLogId_fkey" FOREIGN KEY ("decisionLogId") REFERENCES "PlannerDecisionLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PolicyDecisionLogV2" ADD CONSTRAINT "PolicyDecisionLogV2_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PolicyDecisionLogV2" ADD CONSTRAINT "PolicyDecisionLogV2_contextSnapshotId_fkey" FOREIGN KEY ("contextSnapshotId") REFERENCES "LearnerTwinSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PolicyDecisionLogV2" ADD CONSTRAINT "PolicyDecisionLogV2_linkageTaskId_fkey" FOREIGN KEY ("linkageTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PolicyDecisionLogV2" ADD CONSTRAINT "PolicyDecisionLogV2_linkageAttemptId_fkey" FOREIGN KEY ("linkageAttemptId") REFERENCES "Attempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "policy_log_safe_double"(value TEXT)
RETURNS DOUBLE PRECISION AS $$
BEGIN
  RETURN value::DOUBLE PRECISION;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION "refresh_policy_decision_log_v2"(decision_id TEXT)
RETURNS VOID AS $$
DECLARE
  decision_row RECORD;
  task_id TEXT;
  attempt_id TEXT;
  session_id TEXT;
  chosen_utility DOUBLE PRECISION;
  sum_exp DOUBLE PRECISION;
  propensity_value DOUBLE PRECISION;
  candidate_action_set JSONB;
  pre_action_scores JSONB;
  active_constraints TEXT[];
BEGIN
  SELECT * INTO decision_row
  FROM "PlannerDecisionLog"
  WHERE id = decision_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT ti."taskId"
  INTO task_id
  FROM "TaskInstance" ti
  WHERE ti."decisionLogId" = decision_id
  LIMIT 1;

  IF task_id IS NOT NULL THEN
    SELECT a.id
    INTO attempt_id
    FROM "Attempt" a
    WHERE a."taskId" = task_id
    ORDER BY a."createdAt" DESC
    LIMIT 1;

    SELECT COALESCE(
      t."metaJson"->>'placementSessionId',
      t."metaJson"->>'sessionId'
    )
    INTO session_id
    FROM "Task" t
    WHERE t.id = task_id;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(task_type) ORDER BY first_ord), '[]'::jsonb)
  INTO candidate_action_set
  FROM (
    SELECT task_type, MIN(ord) AS first_ord
    FROM (
      SELECT
        ord,
        NULLIF(elem->>'taskType', '') AS task_type
      FROM jsonb_array_elements(COALESCE(decision_row."candidateSetJson", '[]'::jsonb)) WITH ORDINALITY AS e(elem, ord)
    ) raw
    WHERE task_type IS NOT NULL
    GROUP BY task_type
  ) grouped;

  SELECT COALESCE(jsonb_object_agg(task_type, to_jsonb(score)), '{}'::jsonb)
  INTO pre_action_scores
  FROM (
    SELECT
      NULLIF(elem->>'taskType', '') AS task_type,
      COALESCE(
        "policy_log_safe_double"(elem->>'utility'),
        "policy_log_safe_double"(elem->>'expectedGain'),
        0
      ) AS score
    FROM jsonb_array_elements(COALESCE(decision_row."candidateSetJson", '[]'::jsonb)) AS elem
  ) scored
  WHERE task_type IS NOT NULL;

  SELECT COALESCE(
    "policy_log_safe_double"(elem->>'utility'),
    "policy_log_safe_double"(elem->>'expectedGain')
  )
  INTO chosen_utility
  FROM jsonb_array_elements(COALESCE(decision_row."candidateSetJson", '[]'::jsonb)) AS elem
  WHERE elem->>'taskType' = decision_row."chosenTaskType"
  LIMIT 1;

  SELECT SUM(EXP(COALESCE(
    "policy_log_safe_double"(elem->>'utility'),
    "policy_log_safe_double"(elem->>'expectedGain'),
    0
  )))
  INTO sum_exp
  FROM jsonb_array_elements(COALESCE(decision_row."candidateSetJson", '[]'::jsonb)) AS elem;

  propensity_value := COALESCE(
    "policy_log_safe_double"(decision_row."utilityJson"->>'propensity'),
    CASE
      WHEN sum_exp IS NOT NULL AND sum_exp > 0 AND chosen_utility IS NOT NULL THEN EXP(chosen_utility) / sum_exp
      ELSE NULL
    END
  );

  active_constraints := ARRAY['target_nodes_required'];
  IF COALESCE(decision_row."diagnosticMode", FALSE) THEN
    active_constraints := array_append(active_constraints, 'diagnostic_mode');
  END IF;
  IF COALESCE(decision_row."primaryGoal", '') = 'verify_candidate_nodes' THEN
    active_constraints := array_append(active_constraints, 'verification_sla');
  END IF;
  IF COALESCE((decision_row."utilityJson"->>'rotationApplied')::BOOLEAN, FALSE) THEN
    active_constraints := array_append(active_constraints, 'rotation_diversity');
  END IF;
  IF COALESCE(decision_row."fallbackUsed", FALSE) THEN
    active_constraints := array_append(active_constraints, 'fallback_mode');
  END IF;

  INSERT INTO "PolicyDecisionLogV2" (
    "id",
    "decisionLogId",
    "studentId",
    "policyVersion",
    "contextSnapshotId",
    "candidateActionSet",
    "preActionScores",
    "propensity",
    "activeConstraints",
    "linkageTaskId",
    "linkageAttemptId",
    "linkageSessionId",
    "source",
    "createdAt",
    "updatedAt"
  )
  VALUES (
    decision_row.id || '-v2',
    decision_row.id,
    decision_row."studentId",
    COALESCE(NULLIF(decision_row."utilityJson"->>'policyVersion', ''), 'policy-rules-v1'),
    decision_row."contextSnapshotId",
    COALESCE(candidate_action_set, '[]'::jsonb),
    COALESCE(pre_action_scores, '{}'::jsonb),
    propensity_value,
    active_constraints,
    task_id,
    attempt_id,
    session_id,
    'sql_trigger_v1',
    COALESCE(decision_row."createdAt", CURRENT_TIMESTAMP),
    CURRENT_TIMESTAMP
  )
  ON CONFLICT ("decisionLogId") DO UPDATE SET
    "studentId" = EXCLUDED."studentId",
    "policyVersion" = EXCLUDED."policyVersion",
    "contextSnapshotId" = EXCLUDED."contextSnapshotId",
    "candidateActionSet" = EXCLUDED."candidateActionSet",
    "preActionScores" = EXCLUDED."preActionScores",
    "propensity" = EXCLUDED."propensity",
    "activeConstraints" = EXCLUDED."activeConstraints",
    "linkageTaskId" = EXCLUDED."linkageTaskId",
    "linkageAttemptId" = EXCLUDED."linkageAttemptId",
    "linkageSessionId" = EXCLUDED."linkageSessionId",
    "source" = EXCLUDED."source",
    "updatedAt" = CURRENT_TIMESTAMP;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "trg_policy_log_v2_from_decision"()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM "refresh_policy_decision_log_v2"(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "trg_policy_log_v2_from_task_instance"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."decisionLogId" IS NOT NULL THEN
    PERFORM "refresh_policy_decision_log_v2"(NEW."decisionLogId");
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "trg_policy_log_v2_from_attempt"()
RETURNS TRIGGER AS $$
DECLARE
  decision_id TEXT;
BEGIN
  SELECT ti."decisionLogId"
  INTO decision_id
  FROM "TaskInstance" ti
  WHERE ti."taskId" = NEW."taskId"
  LIMIT 1;

  IF decision_id IS NOT NULL THEN
    PERFORM "refresh_policy_decision_log_v2"(decision_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "policy_log_v2_decision_refresh"
AFTER INSERT OR UPDATE ON "PlannerDecisionLog"
FOR EACH ROW
EXECUTE FUNCTION "trg_policy_log_v2_from_decision"();

CREATE TRIGGER "policy_log_v2_task_instance_refresh"
AFTER INSERT OR UPDATE ON "TaskInstance"
FOR EACH ROW
EXECUTE FUNCTION "trg_policy_log_v2_from_task_instance"();

CREATE TRIGGER "policy_log_v2_attempt_refresh"
AFTER INSERT OR UPDATE ON "Attempt"
FOR EACH ROW
EXECUTE FUNCTION "trg_policy_log_v2_from_attempt"();

DO $$
DECLARE
  row RECORD;
BEGIN
  FOR row IN SELECT id FROM "PlannerDecisionLog"
  LOOP
    PERFORM "refresh_policy_decision_log_v2"(row.id);
  END LOOP;
END;
$$;

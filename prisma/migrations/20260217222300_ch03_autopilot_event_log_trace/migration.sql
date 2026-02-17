-- CH-03: append-only event log + trace linkage backbone

CREATE TABLE "AutopilotDelayedOutcome" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "decisionLogId" TEXT,
    "taskInstanceId" TEXT,
    "taskId" TEXT,
    "attemptId" TEXT,
    "outcomeWindow" TEXT NOT NULL DEFAULT 'same_session',
    "status" TEXT NOT NULL DEFAULT 'recorded',
    "outcomeJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutopilotDelayedOutcome_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutopilotEventLog" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "studentId" TEXT,
    "decisionLogId" TEXT,
    "taskInstanceId" TEXT,
    "taskId" TEXT,
    "attemptId" TEXT,
    "evidenceId" TEXT,
    "delayedOutcomeId" TEXT,
    "payloadJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutopilotEventLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AutopilotDelayedOutcome_studentId_createdAt_idx" ON "AutopilotDelayedOutcome"("studentId", "createdAt");
CREATE INDEX "AutopilotDelayedOutcome_decisionLogId_createdAt_idx" ON "AutopilotDelayedOutcome"("decisionLogId", "createdAt");
CREATE INDEX "AutopilotDelayedOutcome_taskId_createdAt_idx" ON "AutopilotDelayedOutcome"("taskId", "createdAt");
CREATE INDEX "AutopilotDelayedOutcome_attemptId_createdAt_idx" ON "AutopilotDelayedOutcome"("attemptId", "createdAt");
CREATE INDEX "AutopilotDelayedOutcome_outcomeWindow_createdAt_idx" ON "AutopilotDelayedOutcome"("outcomeWindow", "createdAt");

CREATE INDEX "AutopilotEventLog_createdAt_idx" ON "AutopilotEventLog"("createdAt");
CREATE INDEX "AutopilotEventLog_eventType_createdAt_idx" ON "AutopilotEventLog"("eventType", "createdAt");
CREATE INDEX "AutopilotEventLog_studentId_createdAt_idx" ON "AutopilotEventLog"("studentId", "createdAt");
CREATE INDEX "AutopilotEventLog_decisionLogId_createdAt_idx" ON "AutopilotEventLog"("decisionLogId", "createdAt");
CREATE INDEX "AutopilotEventLog_taskId_createdAt_idx" ON "AutopilotEventLog"("taskId", "createdAt");
CREATE INDEX "AutopilotEventLog_attemptId_createdAt_idx" ON "AutopilotEventLog"("attemptId", "createdAt");
CREATE INDEX "AutopilotEventLog_evidenceId_idx" ON "AutopilotEventLog"("evidenceId");
CREATE INDEX "AutopilotEventLog_delayedOutcomeId_idx" ON "AutopilotEventLog"("delayedOutcomeId");

ALTER TABLE "AutopilotDelayedOutcome" ADD CONSTRAINT "AutopilotDelayedOutcome_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AutopilotDelayedOutcome" ADD CONSTRAINT "AutopilotDelayedOutcome_decisionLogId_fkey" FOREIGN KEY ("decisionLogId") REFERENCES "PlannerDecisionLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AutopilotDelayedOutcome" ADD CONSTRAINT "AutopilotDelayedOutcome_taskInstanceId_fkey" FOREIGN KEY ("taskInstanceId") REFERENCES "TaskInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AutopilotDelayedOutcome" ADD CONSTRAINT "AutopilotDelayedOutcome_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AutopilotDelayedOutcome" ADD CONSTRAINT "AutopilotDelayedOutcome_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AutopilotEventLog" ADD CONSTRAINT "AutopilotEventLog_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AutopilotEventLog" ADD CONSTRAINT "AutopilotEventLog_decisionLogId_fkey" FOREIGN KEY ("decisionLogId") REFERENCES "PlannerDecisionLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AutopilotEventLog" ADD CONSTRAINT "AutopilotEventLog_taskInstanceId_fkey" FOREIGN KEY ("taskInstanceId") REFERENCES "TaskInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AutopilotEventLog" ADD CONSTRAINT "AutopilotEventLog_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AutopilotEventLog" ADD CONSTRAINT "AutopilotEventLog_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AutopilotEventLog" ADD CONSTRAINT "AutopilotEventLog_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "AttemptGseEvidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AutopilotEventLog" ADD CONSTRAINT "AutopilotEventLog_delayedOutcomeId_fkey" FOREIGN KEY ("delayedOutcomeId") REFERENCES "AutopilotDelayedOutcome"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "prevent_autopilot_event_log_mutation"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AutopilotEventLog is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "autopilot_event_log_no_update"
BEFORE UPDATE ON "AutopilotEventLog"
FOR EACH ROW
EXECUTE FUNCTION "prevent_autopilot_event_log_mutation"();

CREATE TRIGGER "autopilot_event_log_no_delete"
BEFORE DELETE ON "AutopilotEventLog"
FOR EACH ROW
EXECUTE FUNCTION "prevent_autopilot_event_log_mutation"();

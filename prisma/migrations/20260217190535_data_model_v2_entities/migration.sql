-- AlterTable
ALTER TABLE "PlannerDecisionLog" ADD COLUMN     "contextSnapshotId" TEXT;

-- CreateTable
CREATE TABLE "CausalDiagnosis" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "taxonomyVersion" TEXT NOT NULL DEFAULT 'causal-taxonomy-v1',
    "modelVersion" TEXT NOT NULL,
    "topLabel" TEXT NOT NULL,
    "topProbability" DOUBLE PRECISION NOT NULL,
    "entropy" DOUBLE PRECISION,
    "topMargin" DOUBLE PRECISION,
    "distributionJson" JSONB NOT NULL,
    "confidenceIntervalJson" JSONB,
    "counterfactualJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CausalDiagnosis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearnerTwinSnapshot" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "snapshotTs" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL DEFAULT 'attempt_update',
    "placementStage" TEXT,
    "promotionStage" TEXT,
    "masteryProjectionJson" JSONB NOT NULL,
    "uncertaintyHotspotsJson" JSONB,
    "motivationSignalsJson" JSONB,
    "frictionSignalsJson" JSONB,
    "localeProfileJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearnerTwinSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OODTaskSpec" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "taskInstanceId" TEXT,
    "decisionLogId" TEXT,
    "axisTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "difficultyAnchor" DOUBLE PRECISION,
    "inDomainDifficulty" DOUBLE PRECISION,
    "difficultyDelta" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "verdict" TEXT,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OODTaskSpec_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SelfRepairCycle" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "nodeId" TEXT,
    "sourceAttemptId" TEXT NOT NULL,
    "immediateAttemptId" TEXT,
    "delayedVerificationAttemptId" TEXT,
    "delayedVerificationTaskInstanceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending_immediate_retry',
    "causeLabel" TEXT,
    "loopIndex" INTEGER NOT NULL DEFAULT 1,
    "feedbackJson" JSONB,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SelfRepairCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewQueueItem" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "queueType" TEXT NOT NULL DEFAULT 'memory_review',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reasonCode" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "taskInstanceId" TEXT,
    "attemptId" TEXT,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ReviewQueueItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardTrace" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "decisionLogId" TEXT NOT NULL,
    "taskInstanceId" TEXT,
    "attemptId" TEXT,
    "rewardVersion" TEXT NOT NULL,
    "rewardWindow" TEXT NOT NULL DEFAULT 'same_session',
    "masteryDelta" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "transferReward" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "retentionReward" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "frictionPenalty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalReward" DOUBLE PRECISION NOT NULL,
    "componentsJson" JSONB,
    "outcomeLinkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardTrace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnchorEvalRun" (
    "id" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "rewardVersion" TEXT NOT NULL,
    "datasetVersion" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'started',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "trafficWindowStart" TIMESTAMP(3),
    "trafficWindowEnd" TIMESTAMP(3),
    "metricsJson" JSONB,
    "reportUri" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnchorEvalRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CausalDiagnosis_attemptId_key" ON "CausalDiagnosis"("attemptId");

-- CreateIndex
CREATE INDEX "CausalDiagnosis_studentId_createdAt_idx" ON "CausalDiagnosis"("studentId", "createdAt");

-- CreateIndex
CREATE INDEX "CausalDiagnosis_topLabel_createdAt_idx" ON "CausalDiagnosis"("topLabel", "createdAt");

-- CreateIndex
CREATE INDEX "LearnerTwinSnapshot_studentId_snapshotTs_idx" ON "LearnerTwinSnapshot"("studentId", "snapshotTs");

-- CreateIndex
CREATE INDEX "LearnerTwinSnapshot_source_snapshotTs_idx" ON "LearnerTwinSnapshot"("source", "snapshotTs");

-- CreateIndex
CREATE UNIQUE INDEX "OODTaskSpec_taskInstanceId_key" ON "OODTaskSpec"("taskInstanceId");

-- CreateIndex
CREATE INDEX "OODTaskSpec_studentId_createdAt_idx" ON "OODTaskSpec"("studentId", "createdAt");

-- CreateIndex
CREATE INDEX "OODTaskSpec_studentId_status_createdAt_idx" ON "OODTaskSpec"("studentId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "OODTaskSpec_decisionLogId_idx" ON "OODTaskSpec"("decisionLogId");

-- CreateIndex
CREATE INDEX "SelfRepairCycle_studentId_status_createdAt_idx" ON "SelfRepairCycle"("studentId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "SelfRepairCycle_nodeId_status_idx" ON "SelfRepairCycle"("nodeId", "status");

-- CreateIndex
CREATE INDEX "SelfRepairCycle_delayedVerificationTaskInstanceId_idx" ON "SelfRepairCycle"("delayedVerificationTaskInstanceId");

-- CreateIndex
CREATE UNIQUE INDEX "SelfRepairCycle_sourceAttemptId_loopIndex_key" ON "SelfRepairCycle"("sourceAttemptId", "loopIndex");

-- CreateIndex
CREATE INDEX "ReviewQueueItem_studentId_status_dueAt_idx" ON "ReviewQueueItem"("studentId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "ReviewQueueItem_studentId_nodeId_status_idx" ON "ReviewQueueItem"("studentId", "nodeId", "status");

-- CreateIndex
CREATE INDEX "ReviewQueueItem_taskInstanceId_idx" ON "ReviewQueueItem"("taskInstanceId");

-- CreateIndex
CREATE INDEX "RewardTrace_studentId_createdAt_idx" ON "RewardTrace"("studentId", "createdAt");

-- CreateIndex
CREATE INDEX "RewardTrace_decisionLogId_createdAt_idx" ON "RewardTrace"("decisionLogId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RewardTrace_decisionLogId_rewardWindow_rewardVersion_key" ON "RewardTrace"("decisionLogId", "rewardWindow", "rewardVersion");

-- CreateIndex
CREATE INDEX "AnchorEvalRun_status_startedAt_idx" ON "AnchorEvalRun"("status", "startedAt");

-- CreateIndex
CREATE INDEX "AnchorEvalRun_policyVersion_startedAt_idx" ON "AnchorEvalRun"("policyVersion", "startedAt");

-- CreateIndex
CREATE INDEX "PlannerDecisionLog_contextSnapshotId_idx" ON "PlannerDecisionLog"("contextSnapshotId");

-- AddForeignKey
ALTER TABLE "PlannerDecisionLog" ADD CONSTRAINT "PlannerDecisionLog_contextSnapshotId_fkey" FOREIGN KEY ("contextSnapshotId") REFERENCES "LearnerTwinSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CausalDiagnosis" ADD CONSTRAINT "CausalDiagnosis_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CausalDiagnosis" ADD CONSTRAINT "CausalDiagnosis_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearnerTwinSnapshot" ADD CONSTRAINT "LearnerTwinSnapshot_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OODTaskSpec" ADD CONSTRAINT "OODTaskSpec_decisionLogId_fkey" FOREIGN KEY ("decisionLogId") REFERENCES "PlannerDecisionLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OODTaskSpec" ADD CONSTRAINT "OODTaskSpec_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OODTaskSpec" ADD CONSTRAINT "OODTaskSpec_taskInstanceId_fkey" FOREIGN KEY ("taskInstanceId") REFERENCES "TaskInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelfRepairCycle" ADD CONSTRAINT "SelfRepairCycle_delayedVerificationAttemptId_fkey" FOREIGN KEY ("delayedVerificationAttemptId") REFERENCES "Attempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelfRepairCycle" ADD CONSTRAINT "SelfRepairCycle_delayedVerificationTaskInstanceId_fkey" FOREIGN KEY ("delayedVerificationTaskInstanceId") REFERENCES "TaskInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelfRepairCycle" ADD CONSTRAINT "SelfRepairCycle_immediateAttemptId_fkey" FOREIGN KEY ("immediateAttemptId") REFERENCES "Attempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelfRepairCycle" ADD CONSTRAINT "SelfRepairCycle_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "GseNode"("nodeId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelfRepairCycle" ADD CONSTRAINT "SelfRepairCycle_sourceAttemptId_fkey" FOREIGN KEY ("sourceAttemptId") REFERENCES "Attempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelfRepairCycle" ADD CONSTRAINT "SelfRepairCycle_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewQueueItem" ADD CONSTRAINT "ReviewQueueItem_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewQueueItem" ADD CONSTRAINT "ReviewQueueItem_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "GseNode"("nodeId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewQueueItem" ADD CONSTRAINT "ReviewQueueItem_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewQueueItem" ADD CONSTRAINT "ReviewQueueItem_taskInstanceId_fkey" FOREIGN KEY ("taskInstanceId") REFERENCES "TaskInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardTrace" ADD CONSTRAINT "RewardTrace_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardTrace" ADD CONSTRAINT "RewardTrace_decisionLogId_fkey" FOREIGN KEY ("decisionLogId") REFERENCES "PlannerDecisionLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardTrace" ADD CONSTRAINT "RewardTrace_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardTrace" ADD CONSTRAINT "RewardTrace_taskInstanceId_fkey" FOREIGN KEY ("taskInstanceId") REFERENCES "TaskInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;


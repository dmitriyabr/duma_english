-- AlterTable
ALTER TABLE "Attempt"
ADD COLUMN "nodeOutcomesJson" JSONB,
ADD COLUMN "recoveryTriggered" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "StudentGseMastery"
ADD COLUMN "masteryMean" DOUBLE PRECISION,
ADD COLUMN "masterySigma" DOUBLE PRECISION,
ADD COLUMN "decayedMastery" DOUBLE PRECISION,
ADD COLUMN "halfLifeDays" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "PlannerDecisionLog" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "decisionTs" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "candidateSetJson" JSONB NOT NULL,
    "chosenTaskType" TEXT NOT NULL,
    "utilityJson" JSONB NOT NULL,
    "fallbackUsed" BOOLEAN NOT NULL DEFAULT false,
    "latencyMs" INTEGER,
    "expectedGain" DOUBLE PRECISION,
    "targetNodeIds" TEXT[],
    "selectionReason" TEXT NOT NULL,
    "primaryGoal" TEXT,
    "estimatedDifficulty" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlannerDecisionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskInstance" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "decisionLogId" TEXT,
    "taskType" TEXT NOT NULL,
    "targetNodeIds" TEXT[],
    "specJson" JSONB NOT NULL,
    "fallbackUsed" BOOLEAN NOT NULL DEFAULT false,
    "estimatedDifficulty" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionAudit" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "fromStage" TEXT NOT NULL,
    "targetStage" TEXT NOT NULL,
    "promoted" BOOLEAN NOT NULL,
    "blockedByNodes" TEXT[],
    "reasonsJson" JSONB NOT NULL,
    "readinessScore" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PromotionAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlannerDecisionLog_studentId_decisionTs_idx" ON "PlannerDecisionLog"("studentId", "decisionTs");

-- CreateIndex
CREATE UNIQUE INDEX "TaskInstance_taskId_key" ON "TaskInstance"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskInstance_decisionLogId_key" ON "TaskInstance"("decisionLogId");

-- CreateIndex
CREATE INDEX "TaskInstance_studentId_createdAt_idx" ON "TaskInstance"("studentId", "createdAt");

-- CreateIndex
CREATE INDEX "TaskInstance_decisionLogId_idx" ON "TaskInstance"("decisionLogId");

-- CreateIndex
CREATE INDEX "PromotionAudit_studentId_createdAt_idx" ON "PromotionAudit"("studentId", "createdAt");

-- AddForeignKey
ALTER TABLE "PlannerDecisionLog" ADD CONSTRAINT "PlannerDecisionLog_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskInstance" ADD CONSTRAINT "TaskInstance_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskInstance" ADD CONSTRAINT "TaskInstance_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskInstance" ADD CONSTRAINT "TaskInstance_decisionLogId_fkey" FOREIGN KEY ("decisionLogId") REFERENCES "PlannerDecisionLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionAudit" ADD CONSTRAINT "PromotionAudit_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

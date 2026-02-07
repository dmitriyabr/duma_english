-- AlterTable
ALTER TABLE "LearnerProfile"
ADD COLUMN "placementFresh" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "placementCompletedAt" TIMESTAMP(3),
ADD COLUMN "placementUncertainNodeIds" TEXT[],
ADD COLUMN "placementCarryoverJson" JSONB;

-- AlterTable
ALTER TABLE "PlacementSession"
ADD COLUMN "questionCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "theta" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "sigma" DOUBLE PRECISION NOT NULL DEFAULT 1,
ADD COLUMN "askedItemIds" TEXT[],
ADD COLUMN "currentItemId" TEXT,
ADD COLUMN "stageEstimate" TEXT,
ADD COLUMN "confidenceEstimate" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "PlacementItem" (
    "id" TEXT NOT NULL,
    "skillKey" TEXT NOT NULL,
    "stageBand" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "promptTemplate" TEXT NOT NULL,
    "hint" TEXT,
    "expectedMinWords" INTEGER NOT NULL DEFAULT 12,
    "assessmentMode" TEXT NOT NULL DEFAULT 'stt',
    "maxDurationSec" INTEGER NOT NULL DEFAULT 60,
    "gseTargets" TEXT[],
    "difficulty" DOUBLE PRECISION NOT NULL,
    "discrimination" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "ageBand" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlacementItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlacementResponse" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "attemptId" TEXT,
    "itemScore" DOUBLE PRECISION NOT NULL,
    "observedMetricsJson" JSONB,
    "thetaBefore" DOUBLE PRECISION NOT NULL,
    "thetaAfter" DOUBLE PRECISION NOT NULL,
    "sigmaAfter" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlacementResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlacementItem_active_ageBand_skillKey_idx" ON "PlacementItem"("active", "ageBand", "skillKey");

-- CreateIndex
CREATE INDEX "PlacementItem_difficulty_idx" ON "PlacementItem"("difficulty");

-- CreateIndex
CREATE INDEX "PlacementResponse_sessionId_createdAt_idx" ON "PlacementResponse"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "PlacementResponse_itemId_idx" ON "PlacementResponse"("itemId");

-- CreateIndex
CREATE INDEX "PlacementResponse_attemptId_idx" ON "PlacementResponse"("attemptId");

-- AddForeignKey
ALTER TABLE "PlacementSession" ADD CONSTRAINT "PlacementSession_currentItemId_fkey" FOREIGN KEY ("currentItemId") REFERENCES "PlacementItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlacementResponse" ADD CONSTRAINT "PlacementResponse_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "PlacementSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlacementResponse" ADD CONSTRAINT "PlacementResponse_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "PlacementItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlacementResponse" ADD CONSTRAINT "PlacementResponse_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "LearnerProfile"
ADD COLUMN "stageSource" TEXT NOT NULL DEFAULT 'gse_projection',
ADD COLUMN "stageEvidenceJson" JSONB;

-- CreateTable
CREATE TABLE "GseStageProjection" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "stageScore" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "evidenceJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GseStageProjection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GseStageProjection_studentId_createdAt_idx" ON "GseStageProjection"("studentId", "createdAt");

-- AddForeignKey
ALTER TABLE "GseStageProjection" ADD CONSTRAINT "GseStageProjection_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "AttemptGseEvidence" ADD COLUMN     "activationImpact" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN     "targeted" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "StudentGseMastery" ADD COLUMN     "activationState" TEXT NOT NULL DEFAULT 'observed',
ADD COLUMN     "supportingEvidenceCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "incidentalTaskTypeCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "verificationDueAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "AttemptGseEvidence_studentId_nodeId_usedForPromotion_idx" ON "AttemptGseEvidence"("studentId", "nodeId", "usedForPromotion");

-- CreateIndex
CREATE INDEX "StudentGseMastery_studentId_activationState_verificationDue_idx" ON "StudentGseMastery"("studentId", "activationState", "verificationDueAt");

-- CH-09 cause-attributed evidence write path

ALTER TABLE "AttemptGseEvidence"
ADD COLUMN "causeTopLabel" TEXT,
ADD COLUMN "causeTopProbability" DOUBLE PRECISION,
ADD COLUMN "causeDistributionJson" JSONB,
ADD COLUMN "causeModelVersion" TEXT;

CREATE INDEX "AttemptGseEvidence_causeTopLabel_createdAt_idx"
ON "AttemptGseEvidence"("causeTopLabel", "createdAt");

ALTER TABLE "StudentGseMastery"
ADD COLUMN "dominantCauseLabel" TEXT,
ADD COLUMN "dominantCauseProbability" DOUBLE PRECISION,
ADD COLUMN "dominantCauseDistributionJson" JSONB,
ADD COLUMN "dominantCauseModelVersion" TEXT;

CREATE INDEX "StudentGseMastery_studentId_dominantCauseLabel_idx"
ON "StudentGseMastery"("studentId", "dominantCauseLabel");

-- AlterTable
ALTER TABLE "AttemptGseEvidence"
  ADD COLUMN IF NOT EXISTS "evidenceKind" TEXT NOT NULL DEFAULT 'supporting',
  ADD COLUMN IF NOT EXISTS "opportunityType" TEXT NOT NULL DEFAULT 'incidental',
  ADD COLUMN IF NOT EXISTS "score" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS "weight" DOUBLE PRECISION NOT NULL DEFAULT 0.2,
  ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'rules',
  ADD COLUMN IF NOT EXISTS "domain" TEXT,
  ADD COLUMN IF NOT EXISTS "usedForPromotion" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "StudentGseMastery"
  ADD COLUMN IF NOT EXISTS "alpha" DOUBLE PRECISION NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "beta" DOUBLE PRECISION NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "uncertainty" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "directEvidenceCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "negativeEvidenceCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "crossTaskEvidenceCount" INTEGER NOT NULL DEFAULT 0;

-- Backfill alpha/beta from existing mastery score and evidence count.
UPDATE "StudentGseMastery"
SET
  "alpha" = GREATEST(1, ((COALESCE("masteryMean", "masteryScore", 25) / 100.0) * GREATEST(2, "evidenceCount" + 2))),
  "beta" = GREATEST(1, ((1 - (COALESCE("masteryMean", "masteryScore", 25) / 100.0)) * GREATEST(2, "evidenceCount" + 2)))
WHERE COALESCE("alpha", 1) = 1 AND COALESCE("beta", 1) = 1;

UPDATE "StudentGseMastery"
SET "uncertainty" = 1.0 / SQRT(GREATEST(2, "alpha" + "beta"))
WHERE "uncertainty" IS NULL;

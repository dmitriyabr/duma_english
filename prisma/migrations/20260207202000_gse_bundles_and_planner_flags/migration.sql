-- Learner profile cold-start fields
ALTER TABLE "LearnerProfile"
  ADD COLUMN IF NOT EXISTS "coldStartActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "coldStartAttempts" INTEGER NOT NULL DEFAULT 0;

-- Planner decision extra explainability fields
ALTER TABLE "PlannerDecisionLog"
  ADD COLUMN IF NOT EXISTS "domainsTargeted" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "diagnosticMode" BOOLEAN NOT NULL DEFAULT false;

-- Bundle tables
CREATE TABLE IF NOT EXISTS "GseBundle" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "stage" TEXT NOT NULL,
  "domain" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "requiredCoverage" DOUBLE PRECISION NOT NULL DEFAULT 0.65,
  "minDirectEvidence" INTEGER NOT NULL DEFAULT 12,
  "reliabilityGate" DOUBLE PRECISION NOT NULL DEFAULT 0.65,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "metadataJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GseBundle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "GseBundleNode" (
  "id" TEXT NOT NULL,
  "bundleId" TEXT NOT NULL,
  "nodeId" TEXT NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT true,
  "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GseBundleNode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "GseBundle_key_key" ON "GseBundle"("key");
CREATE INDEX IF NOT EXISTS "GseBundle_stage_domain_active_idx" ON "GseBundle"("stage", "domain", "active");
CREATE UNIQUE INDEX IF NOT EXISTS "GseBundleNode_bundleId_nodeId_key" ON "GseBundleNode"("bundleId", "nodeId");
CREATE INDEX IF NOT EXISTS "GseBundleNode_nodeId_idx" ON "GseBundleNode"("nodeId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'GseBundleNode_bundleId_fkey'
  ) THEN
    ALTER TABLE "GseBundleNode"
      ADD CONSTRAINT "GseBundleNode_bundleId_fkey"
      FOREIGN KEY ("bundleId") REFERENCES "GseBundle"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'GseBundleNode_nodeId_fkey'
  ) THEN
    ALTER TABLE "GseBundleNode"
      ADD CONSTRAINT "GseBundleNode_nodeId_fkey"
      FOREIGN KEY ("nodeId") REFERENCES "GseNode"("nodeId")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

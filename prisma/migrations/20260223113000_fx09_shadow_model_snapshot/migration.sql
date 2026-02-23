-- CreateTable
CREATE TABLE "ShadowPolicyModelSnapshot" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "weightsJson" JSONB NOT NULL,
    "trainedAt" TIMESTAMP(3) NOT NULL,
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShadowPolicyModelSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShadowPolicyModelSnapshot_version_key" ON "ShadowPolicyModelSnapshot"("version");

-- CreateIndex
CREATE INDEX "ShadowPolicyModelSnapshot_isActive_trainedAt_idx" ON "ShadowPolicyModelSnapshot"("isActive", "trainedAt");

-- CreateIndex
CREATE INDEX "ShadowPolicyModelSnapshot_trainedAt_idx" ON "ShadowPolicyModelSnapshot"("trainedAt");

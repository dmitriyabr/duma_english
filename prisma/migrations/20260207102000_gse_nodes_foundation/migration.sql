-- CreateTable
CREATE TABLE "GseCatalogVersion" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "description" TEXT,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GseCatalogVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GseNode" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "catalog" TEXT NOT NULL,
    "gseMin" INTEGER,
    "gseMax" INTEGER,
    "gseCenter" DOUBLE PRECISION,
    "cefrBand" TEXT,
    "audience" TEXT,
    "skill" TEXT,
    "descriptor" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceVersion" TEXT,
    "licenseTag" TEXT,
    "metadataJson" JSONB,
    "catalogVersionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GseNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GseNodeAlias" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GseNodeAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GseNodeEdge" (
    "id" TEXT NOT NULL,
    "fromNodeId" TEXT NOT NULL,
    "toNodeId" TEXT NOT NULL,
    "edgeType" TEXT NOT NULL,
    "weight" DOUBLE PRECISION,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GseNodeEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttemptGseEvidence" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "signalType" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "impact" DOUBLE PRECISION NOT NULL,
    "evidenceText" TEXT,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AttemptGseEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentGseMastery" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "masteryScore" DOUBLE PRECISION NOT NULL,
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "reliability" TEXT NOT NULL,
    "lastEvidenceAt" TIMESTAMP(3),
    "decayStateJson" JSONB,
    "spacingStateJson" JSONB,
    "calculationVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StudentGseMastery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskGseTarget" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskGseTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GseCatalogVersion_version_key" ON "GseCatalogVersion"("version");

-- CreateIndex
CREATE UNIQUE INDEX "GseNode_nodeId_key" ON "GseNode"("nodeId");

-- CreateIndex
CREATE INDEX "GseNode_catalogVersionId_type_idx" ON "GseNode"("catalogVersionId", "type");

-- CreateIndex
CREATE INDEX "GseNode_catalogVersionId_audience_skill_idx" ON "GseNode"("catalogVersionId", "audience", "skill");

-- CreateIndex
CREATE UNIQUE INDEX "GseNodeAlias_nodeId_alias_key" ON "GseNodeAlias"("nodeId", "alias");

-- CreateIndex
CREATE INDEX "GseNodeAlias_alias_idx" ON "GseNodeAlias"("alias");

-- CreateIndex
CREATE UNIQUE INDEX "GseNodeEdge_fromNodeId_toNodeId_edgeType_key" ON "GseNodeEdge"("fromNodeId", "toNodeId", "edgeType");

-- CreateIndex
CREATE INDEX "GseNodeEdge_toNodeId_edgeType_idx" ON "GseNodeEdge"("toNodeId", "edgeType");

-- CreateIndex
CREATE INDEX "AttemptGseEvidence_attemptId_idx" ON "AttemptGseEvidence"("attemptId");

-- CreateIndex
CREATE INDEX "AttemptGseEvidence_studentId_nodeId_idx" ON "AttemptGseEvidence"("studentId", "nodeId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentGseMastery_studentId_nodeId_key" ON "StudentGseMastery"("studentId", "nodeId");

-- CreateIndex
CREATE INDEX "StudentGseMastery_studentId_masteryScore_idx" ON "StudentGseMastery"("studentId", "masteryScore");

-- CreateIndex
CREATE UNIQUE INDEX "TaskGseTarget_taskId_nodeId_key" ON "TaskGseTarget"("taskId", "nodeId");

-- CreateIndex
CREATE INDEX "TaskGseTarget_nodeId_idx" ON "TaskGseTarget"("nodeId");

-- AddForeignKey
ALTER TABLE "GseNode" ADD CONSTRAINT "GseNode_catalogVersionId_fkey" FOREIGN KEY ("catalogVersionId") REFERENCES "GseCatalogVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GseNodeAlias" ADD CONSTRAINT "GseNodeAlias_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "GseNode"("nodeId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GseNodeEdge" ADD CONSTRAINT "GseNodeEdge_fromNodeId_fkey" FOREIGN KEY ("fromNodeId") REFERENCES "GseNode"("nodeId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GseNodeEdge" ADD CONSTRAINT "GseNodeEdge_toNodeId_fkey" FOREIGN KEY ("toNodeId") REFERENCES "GseNode"("nodeId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptGseEvidence" ADD CONSTRAINT "AttemptGseEvidence_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptGseEvidence" ADD CONSTRAINT "AttemptGseEvidence_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptGseEvidence" ADD CONSTRAINT "AttemptGseEvidence_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "GseNode"("nodeId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentGseMastery" ADD CONSTRAINT "StudentGseMastery_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentGseMastery" ADD CONSTRAINT "StudentGseMastery_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "GseNode"("nodeId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskGseTarget" ADD CONSTRAINT "TaskGseTarget_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskGseTarget" ADD CONSTRAINT "TaskGseTarget_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "GseNode"("nodeId") ON DELETE CASCADE ON UPDATE CASCADE;

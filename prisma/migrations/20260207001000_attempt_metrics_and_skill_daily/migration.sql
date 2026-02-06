-- CreateTable
CREATE TABLE "AttemptMetric" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "metricKey" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "reliability" TEXT NOT NULL,
    "calculationVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AttemptMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentSkillDaily" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "skillKey" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "sampleCount" INTEGER NOT NULL DEFAULT 1,
    "reliability" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StudentSkillDaily_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttemptMetric_attemptId_idx" ON "AttemptMetric"("attemptId");

-- CreateIndex
CREATE INDEX "AttemptMetric_studentId_metricKey_idx" ON "AttemptMetric"("studentId", "metricKey");

-- CreateIndex
CREATE UNIQUE INDEX "StudentSkillDaily_studentId_date_skillKey_key" ON "StudentSkillDaily"("studentId", "date", "skillKey");

-- CreateIndex
CREATE INDEX "StudentSkillDaily_studentId_skillKey_date_idx" ON "StudentSkillDaily"("studentId", "skillKey", "date");

-- AddForeignKey
ALTER TABLE "AttemptMetric" ADD CONSTRAINT "AttemptMetric_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptMetric" ADD CONSTRAINT "AttemptMetric_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentSkillDaily" ADD CONSTRAINT "StudentSkillDaily_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

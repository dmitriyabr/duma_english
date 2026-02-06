-- CreateTable
CREATE TABLE "LearnerProfile" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'A0',
    "ageBand" TEXT NOT NULL DEFAULT '9-11',
    "placementScore" DOUBLE PRECISION,
    "placementConfidence" DOUBLE PRECISION,
    "activeTrack" TEXT NOT NULL DEFAULT 'balanced_convo_speech',
    "cycleWeek" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LearnerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentSkillMastery" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "skillKey" TEXT NOT NULL,
    "masteryScore" DOUBLE PRECISION NOT NULL,
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "reliability" TEXT NOT NULL,
    "lastAssessedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StudentSkillMastery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentVocabulary" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "lemma" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "nextReviewAt" TIMESTAMP(3),
    "retentionScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "usageEvidenceCount" INTEGER NOT NULL DEFAULT 0,
    "sourceTopicId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StudentVocabulary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LearnerProfile_studentId_key" ON "LearnerProfile"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentSkillMastery_studentId_skillKey_key" ON "StudentSkillMastery"("studentId", "skillKey");

-- CreateIndex
CREATE INDEX "StudentSkillMastery_studentId_idx" ON "StudentSkillMastery"("studentId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentVocabulary_studentId_lemma_key" ON "StudentVocabulary"("studentId", "lemma");

-- CreateIndex
CREATE INDEX "StudentVocabulary_studentId_status_nextReviewAt_idx" ON "StudentVocabulary"("studentId", "status", "nextReviewAt");

-- AddForeignKey
ALTER TABLE "LearnerProfile" ADD CONSTRAINT "LearnerProfile_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentSkillMastery" ADD CONSTRAINT "StudentSkillMastery_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentVocabulary" ADD CONSTRAINT "StudentVocabulary_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

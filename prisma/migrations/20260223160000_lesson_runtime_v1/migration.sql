-- Lesson runtime v1 (PX-01..PX-12 core entities)

ALTER TABLE "Attempt"
ADD COLUMN "pronunciationIssuesJson" JSONB;

CREATE TABLE "LessonSession" (
  "id" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "classId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "missionJson" JSONB NOT NULL,
  "progressJson" JSONB NOT NULL,
  "currentStepIndex" INTEGER NOT NULL DEFAULT 0,
  "currentTurnIndex" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "LessonSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LessonStep" (
  "id" TEXT NOT NULL,
  "lessonSessionId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "stepType" TEXT NOT NULL,
  "taskId" TEXT,
  "taskInstanceId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "source" TEXT NOT NULL DEFAULT 'mission',
  "targetNodeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "score" DOUBLE PRECISION,
  "metaJson" JSONB,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "LessonStep_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LessonTurn" (
  "id" TEXT NOT NULL,
  "lessonStepId" TEXT NOT NULL,
  "turnIndex" INTEGER NOT NULL,
  "role" TEXT NOT NULL,
  "promptText" TEXT,
  "attemptId" TEXT,
  "status" TEXT NOT NULL,
  "evaluationJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LessonTurn_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LessonStep_lessonSessionId_ordinal_key"
ON "LessonStep"("lessonSessionId", "ordinal");

CREATE UNIQUE INDEX "LessonTurn_lessonStepId_turnIndex_key"
ON "LessonTurn"("lessonStepId", "turnIndex");

CREATE INDEX "LessonSession_studentId_status_idx"
ON "LessonSession"("studentId", "status");

CREATE INDEX "LessonSession_classId_status_idx"
ON "LessonSession"("classId", "status");

CREATE INDEX "LessonSession_startedAt_idx"
ON "LessonSession"("startedAt");

CREATE INDEX "LessonStep_lessonSessionId_ordinal_idx"
ON "LessonStep"("lessonSessionId", "ordinal");

CREATE INDEX "LessonStep_lessonSessionId_status_idx"
ON "LessonStep"("lessonSessionId", "status");

CREATE INDEX "LessonTurn_lessonStepId_turnIndex_idx"
ON "LessonTurn"("lessonStepId", "turnIndex");

CREATE INDEX "LessonTurn_attemptId_idx"
ON "LessonTurn"("attemptId");

ALTER TABLE "LessonSession"
ADD CONSTRAINT "LessonSession_studentId_fkey"
FOREIGN KEY ("studentId") REFERENCES "Student"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LessonSession"
ADD CONSTRAINT "LessonSession_classId_fkey"
FOREIGN KEY ("classId") REFERENCES "Class"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LessonStep"
ADD CONSTRAINT "LessonStep_lessonSessionId_fkey"
FOREIGN KEY ("lessonSessionId") REFERENCES "LessonSession"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LessonStep"
ADD CONSTRAINT "LessonStep_taskId_fkey"
FOREIGN KEY ("taskId") REFERENCES "Task"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LessonStep"
ADD CONSTRAINT "LessonStep_taskInstanceId_fkey"
FOREIGN KEY ("taskInstanceId") REFERENCES "TaskInstance"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LessonTurn"
ADD CONSTRAINT "LessonTurn_lessonStepId_fkey"
FOREIGN KEY ("lessonStepId") REFERENCES "LessonStep"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LessonTurn"
ADD CONSTRAINT "LessonTurn_attemptId_fkey"
FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

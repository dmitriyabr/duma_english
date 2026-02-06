-- CreateTable
CREATE TABLE "PlacementSession" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'started',
    "currentIndex" INTEGER NOT NULL DEFAULT 0,
    "responsesJson" JSONB,
    "resultJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "PlacementSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlacementSession_studentId_status_idx" ON "PlacementSession"("studentId", "status");

-- AddForeignKey
ALTER TABLE "PlacementSession" ADD CONSTRAINT "PlacementSession_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Teacher" ADD COLUMN "email" TEXT,
ADD COLUMN "passwordHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Teacher_email_key" ON "Teacher"("email");

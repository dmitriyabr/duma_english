-- AlterTable
ALTER TABLE "Student" ADD COLUMN "loginCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Student_loginCode_key" ON "Student"("loginCode");

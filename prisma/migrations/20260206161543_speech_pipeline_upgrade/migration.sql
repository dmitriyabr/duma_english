-- AlterTable
ALTER TABLE "Attempt" ADD COLUMN     "durationSec" DOUBLE PRECISION,
ADD COLUMN     "errorCode" TEXT,
ADD COLUMN     "errorMessage" TEXT,
ADD COLUMN     "rawRecognitionJson" JSONB;

-- AlterTable
ALTER TABLE "PlacementSession" ADD COLUMN     "conversationTheme" TEXT,
ADD COLUMN     "placementMode" TEXT DEFAULT 'irt',
ADD COLUMN     "stageHistory" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "transcriptHistory" TEXT[] DEFAULT ARRAY[]::TEXT[];

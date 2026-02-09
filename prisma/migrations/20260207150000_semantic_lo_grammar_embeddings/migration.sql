-- CreateTable
CREATE TABLE "GseNodeEmbedding" (
    "id" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "textHash" TEXT NOT NULL,
    "vector" JSONB NOT NULL,
    "dim" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GseNodeEmbedding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GseNodeEmbedding_model_idx" ON "GseNodeEmbedding"("model");

-- CreateIndex
CREATE UNIQUE INDEX "GseNodeEmbedding_nodeId_key" ON "GseNodeEmbedding"("nodeId");

-- AddForeignKey
ALTER TABLE "GseNodeEmbedding" ADD CONSTRAINT "GseNodeEmbedding_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "GseNode"("nodeId") ON DELETE CASCADE ON UPDATE CASCADE;

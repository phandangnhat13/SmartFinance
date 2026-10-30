-- CreateEnum
CREATE TYPE "SpendingAlertType" AS ENUM ('LARGE_TRANSACTION', 'CATEGORY_SPIKE', 'POSSIBLE_DUPLICATE');

-- CreateEnum
CREATE TYPE "SpendingAlertSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "SpendingAlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'DISMISSED', 'MARKED_NORMAL');

-- CreateTable
CREATE TABLE "spending_alerts" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "SpendingAlertType" NOT NULL,
    "severity" "SpendingAlertSeverity" NOT NULL,
    "status" "SpendingAlertStatus" NOT NULL DEFAULT 'OPEN',
    "dedupeKey" TEXT NOT NULL,
    "transactionId" UUID,
    "relatedTransactionId" UUID,
    "categoryId" UUID,
    "periodStart" DATE,
    "periodEnd" DATE,
    "score" DECIMAL(10,4),
    "facts" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "spending_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "spending_alerts_userId_status_createdAt_idx" ON "spending_alerts"("userId", "status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "spending_alerts_userId_type_createdAt_idx" ON "spending_alerts"("userId", "type", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "spending_alerts_userId_dedupeKey_key" ON "spending_alerts"("userId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "spending_alerts" ADD CONSTRAINT "spending_alerts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spending_alerts" ADD CONSTRAINT "spending_alerts_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spending_alerts" ADD CONSTRAINT "spending_alerts_relatedTransactionId_fkey" FOREIGN KEY ("relatedTransactionId") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spending_alerts" ADD CONSTRAINT "spending_alerts_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

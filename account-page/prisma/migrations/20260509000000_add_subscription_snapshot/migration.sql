CREATE TABLE "SubscriptionSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "customerId" TEXT,
    "snapshotAt" DATETIME NOT NULL,
    "contractData" TEXT NOT NULL,
    "billingCycles" TEXT NOT NULL,
    "billingMetadata" TEXT NOT NULL,
    "isRestored" BOOLEAN NOT NULL DEFAULT false,
    "restoredAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "SubscriptionSnapshot_shop_contractId_snapshotAt_key" ON "SubscriptionSnapshot"("shop", "contractId", "snapshotAt");
CREATE INDEX "SubscriptionSnapshot_shop_isRestored_idx" ON "SubscriptionSnapshot"("shop", "isRestored");
CREATE INDEX "SubscriptionSnapshot_shop_createdAt_idx" ON "SubscriptionSnapshot"("shop", "createdAt");

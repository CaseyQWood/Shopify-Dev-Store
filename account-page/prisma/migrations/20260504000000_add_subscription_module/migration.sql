CREATE TABLE "SubscriptionRenewalRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "windowStart" DATETIME NOT NULL,
    "windowEnd" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "jobId" TEXT,
    "errorMessage" TEXT,
    "resultSummary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "SubscriptionAdminActionAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "adminEmail" TEXT,
    "action" TEXT NOT NULL,
    "contractId" TEXT,
    "targetId" TEXT,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "SubscriptionRenewalRun_idempotencyKey_key" ON "SubscriptionRenewalRun"("idempotencyKey");
CREATE UNIQUE INDEX "SubscriptionRenewalRun_shop_windowStart_windowEnd_key" ON "SubscriptionRenewalRun"("shop", "windowStart", "windowEnd");
CREATE INDEX "SubscriptionRenewalRun_shop_status_idx" ON "SubscriptionRenewalRun"("shop", "status");
CREATE INDEX "SubscriptionRenewalRun_jobId_idx" ON "SubscriptionRenewalRun"("jobId");
CREATE INDEX "SubscriptionAdminActionAudit_shop_createdAt_idx" ON "SubscriptionAdminActionAudit"("shop", "createdAt");
CREATE INDEX "SubscriptionAdminActionAudit_contractId_idx" ON "SubscriptionAdminActionAudit"("contractId");

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Session_shop_idx" ON "Session"("shop");

-- CreateTable
CREATE TABLE "SubscriptionRenewalRun" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "jobId" TEXT,
    "errorMessage" TEXT,
    "resultSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionRenewalRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionRenewalRun_idempotencyKey_key"
    ON "SubscriptionRenewalRun"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionRenewalRun_shop_windowStart_windowEnd_key"
    ON "SubscriptionRenewalRun"("shop", "windowStart", "windowEnd");

-- CreateIndex
CREATE INDEX "SubscriptionRenewalRun_shop_status_idx"
    ON "SubscriptionRenewalRun"("shop", "status");

-- CreateIndex
CREATE INDEX "SubscriptionRenewalRun_jobId_idx"
    ON "SubscriptionRenewalRun"("jobId");

-- CreateTable
CREATE TABLE "SubscriptionAdminActionAudit" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "adminEmail" TEXT,
    "action" TEXT NOT NULL,
    "contractId" TEXT,
    "targetId" TEXT,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionAdminActionAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubscriptionAdminActionAudit_shop_createdAt_idx"
    ON "SubscriptionAdminActionAudit"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "SubscriptionAdminActionAudit_contractId_idx"
    ON "SubscriptionAdminActionAudit"("contractId");

-- CreateTable
CREATE TABLE "SubscriptionSnapshot" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "customerId" TEXT,
    "snapshotAt" TIMESTAMP(3) NOT NULL,
    "contractData" TEXT NOT NULL,
    "billingCycles" TEXT NOT NULL,
    "billingMetadata" TEXT NOT NULL,
    "isRestored" BOOLEAN NOT NULL DEFAULT false,
    "restoredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionSnapshot_shop_contractId_snapshotAt_key"
    ON "SubscriptionSnapshot"("shop", "contractId", "snapshotAt");

-- CreateIndex
CREATE INDEX "SubscriptionSnapshot_shop_isRestored_idx"
    ON "SubscriptionSnapshot"("shop", "isRestored");

-- CreateIndex
CREATE INDEX "SubscriptionSnapshot_shop_createdAt_idx"
    ON "SubscriptionSnapshot"("shop", "createdAt");

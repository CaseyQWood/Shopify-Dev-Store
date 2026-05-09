import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const API_VERSION = process.env.SHOPIFY_SUBSCRIPTION_API_VERSION || "2026-04";
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_LOOKBACK_HOURS = 24;
const DEFAULT_LEAD_HOURS = 24;
const RUNNING_LOCK_MS = 2 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Snapshot pass
// ---------------------------------------------------------------------------

const SNAPSHOT_DEFAULT_INTERVAL_HOURS = 24;
const SNAPSHOT_DEFAULT_RETENTION_DAYS = 90;

const ACTIVE_CONTRACTS_QUERY = `#graphql
  query ActiveSubscriptionContracts($first: Int!, $after: String) {
    subscriptionContracts(first: $first, after: $after, query: "status:ACTIVE") {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        customer {
          id
        }
      }
    }
  }
`;

const SNAPSHOT_CONTRACT_QUERY = `#graphql
  query SnapshotContractDetail($id: ID!, $cycleStart: DateTime!, $cycleEnd: DateTime!) {
    subscriptionContract(id: $id) {
      id
      status
      nextBillingDate
      createdAt
      updatedAt
      currencyCode
      lastPaymentStatus
      lastBillingAttemptErrorType
      customer {
        id
        displayName
        email
        phone
      }
      billingPolicy {
        interval
        intervalCount
      }
      deliveryPolicy {
        interval
        intervalCount
      }
      lines(first: 25) {
        nodes {
          id
          title
          variantTitle
          quantity
          variantId
          productId
          currentPrice {
            amount
            currencyCode
          }
          lineDiscountedPrice {
            amount
            currencyCode
          }
        }
      }
      billingAttempts(first: 5, reverse: true) {
        nodes {
          id
          ready
          errorCode
          errorMessage
          order {
            id
            name
          }
          processingError {
            code
            message
          }
        }
      }
    }
    subscriptionBillingCycles(
      first: 6
      contractId: $id
      sortKey: CYCLE_INDEX
      billingCyclesDateRangeSelector: {startDate: $cycleStart, endDate: $cycleEnd}
    ) {
      nodes {
        cycleIndex
        billingAttemptExpectedDate
        cycleStartAt
        cycleEndAt
        status
        skipped
        edited
      }
    }
  }
`;

function isSnapshotsEnabled() {
  return process.env.SUBSCRIPTION_SNAPSHOTS_ENABLED === "true";
}

function snapshotIntervalHours() {
  const v = Number(process.env.SUBSCRIPTION_SNAPSHOT_INTERVAL_HOURS);
  return Number.isFinite(v) && v > 0 ? v : SNAPSHOT_DEFAULT_INTERVAL_HOURS;
}

function snapshotRetentionDays() {
  const v = Number(process.env.SUBSCRIPTION_SNAPSHOT_RETENTION_DAYS);
  return Number.isFinite(v) && v > 0 ? v : SNAPSHOT_DEFAULT_RETENTION_DAYS;
}

function snapshotDateRange() {
  const now = new Date();
  const end = new Date(now.getTime() + 730 * 24 * 60 * 60 * 1000);
  return {
    cycleStart: now.toISOString().replace("Z", "Z"),
    cycleEnd: end.toISOString().replace("Z", "Z"),
  };
}

async function captureSnapshotForContract(session, contractId) {
  const snapshotAt = new Date();
  snapshotAt.setUTCSeconds(0, 0);

  const data = await adminGraphql(
    session.shop,
    session.accessToken,
    SNAPSHOT_CONTRACT_QUERY,
    { id: contractId, ...snapshotDateRange() },
  );

  const contract = data.subscriptionContract;
  if (!contract) return null;

  const customerId = contract.customer?.id ?? null;
  const contractData = JSON.stringify(contract);
  const billingCycles = JSON.stringify(
    data.subscriptionBillingCycles?.nodes ?? [],
  );
  const billingMetadata = JSON.stringify({
    lastPaymentStatus: contract.lastPaymentStatus ?? null,
    lastBillingAttemptErrorType: contract.lastBillingAttemptErrorType ?? null,
    billingPolicy: contract.billingPolicy ?? null,
    deliveryPolicy: contract.deliveryPolicy ?? null,
    capturedAt: snapshotAt.toISOString(),
  });

  try {
    const row = await prisma.subscriptionSnapshot.create({
      data: {
        shop: session.shop,
        contractId,
        customerId,
        snapshotAt,
        contractData,
        billingCycles,
        billingMetadata,
      },
    });

    await prisma.subscriptionAdminActionAudit.create({
      data: {
        shop: session.shop,
        action: "snapshot.captured",
        contractId,
        targetId: row.id,
        status: "SUCCESS",
        message: `Worker snapshot ${row.id} captured.`,
      },
    });

    return row.id;
  } catch (err) {
    // P2002 = unique constraint — snapshot already exists for this minute window
    if (err && typeof err === "object" && err.code === "P2002") return null;
    throw err;
  }
}

async function shouldCaptureSnapshot(shop, contractId) {
  const intervalHours = snapshotIntervalHours();
  const cutoff = new Date(Date.now() - intervalHours * 60 * 60 * 1000);

  const recent = await prisma.subscriptionSnapshot.findFirst({
    where: {
      shop,
      contractId,
      snapshotAt: { gte: cutoff },
    },
    orderBy: { snapshotAt: "desc" },
  });

  return !recent;
}

async function runSnapshotPass(session) {
  if (!isSnapshotsEnabled()) return;

  let after = null;
  let capturedCount = 0;
  let errorCount = 0;

  do {
    const data = await adminGraphql(
      session.shop,
      session.accessToken,
      ACTIVE_CONTRACTS_QUERY,
      { first: 50, after },
    );

    const connection = data.subscriptionContracts;
    const nodes = connection?.nodes ?? [];

    for (const node of nodes) {
      if (!node.id) continue;

      const needsSnapshot = await shouldCaptureSnapshot(session.shop, node.id);
      if (!needsSnapshot) continue;

      try {
        await captureSnapshotForContract(session, node.id);
        capturedCount++;
      } catch (err) {
        errorCount++;
        console.error(
          `[snapshot-worker] failed to snapshot contract ${node.id}:`,
          err,
        );
      }
    }

    after = connection?.pageInfo?.hasNextPage
      ? connection.pageInfo.endCursor
      : null;
  } while (after);

  if (capturedCount > 0 || errorCount > 0) {
    console.log(
      `[snapshot-worker] ${session.shop}: captured=${capturedCount} errors=${errorCount}`,
    );
  }

  await pruneOldSnapshotsForShop(session.shop);
}

async function pruneOldSnapshotsForShop(shop) {
  const retentionDays = snapshotRetentionDays();
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  const result = await prisma.subscriptionSnapshot.deleteMany({
    where: {
      shop,
      isRestored: true,
      createdAt: { lt: cutoff },
    },
  });

  if (result.count > 0) {
    await prisma.subscriptionAdminActionAudit.create({
      data: {
        shop,
        action: "snapshot.pruned",
        status: "SUCCESS",
        message: `Pruned ${result.count} snapshot(s) older than ${retentionDays} days.`,
        metadata: JSON.stringify({
          count: result.count,
          retentionDays,
          cutoff: cutoff.toISOString(),
        }),
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Renewal pass
// ---------------------------------------------------------------------------

const BULK_CHARGE_MUTATION = `#graphql
  mutation SubscriptionBillingCycleBulkCharge(
    $startDate: DateTime!
    $endDate: DateTime!
    $filters: SubscriptionBillingCycleBulkFilters!
  ) {
    subscriptionBillingCycleBulkCharge(
      billingAttemptExpectedDateRange: {startDate: $startDate, endDate: $endDate}
      filters: $filters
    ) {
      job {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const JOB_QUERY = `#graphql
  query SubscriptionRenewalJob($id: ID!) {
    job(id: $id) {
      id
      done
    }
  }
`;

const BULK_RESULTS_QUERY = `#graphql
  query SubscriptionBillingCycleBulkResults($jobId: ID!, $first: Int!, $after: String) {
    subscriptionBillingCycleBulkResults(first: $first, after: $after, jobId: $jobId) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        cycleIndex
        status
        skipped
        billingAttemptExpectedDate
        sourceContract {
          id
        }
        billingAttempts(first: 1, reverse: true) {
          nodes {
            id
            ready
            errorCode
            errorMessage
            order {
              id
              name
            }
            processingError {
              code
              message
            }
          }
        }
      }
    }
  }
`;

function isWorkerEnabled() {
  return process.env.SUBSCRIPTION_WORKER_ENABLED === "true";
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function dateToHour(date) {
  const copy = new Date(date);
  copy.setUTCMinutes(0, 0, 0);
  return copy;
}

function renewalWindow(now = new Date()) {
  const anchor = dateToHour(now);
  const lookbackHours = numberEnv(
    "SUBSCRIPTION_WORKER_LOOKBACK_HOURS",
    DEFAULT_LOOKBACK_HOURS,
  );
  const leadHours = numberEnv(
    "SUBSCRIPTION_WORKER_LEAD_HOURS",
    DEFAULT_LEAD_HOURS,
  );

  return {
    windowStart: new Date(anchor.getTime() - lookbackHours * 60 * 60 * 1000),
    windowEnd: new Date(anchor.getTime() + leadHours * 60 * 60 * 1000),
  };
}

function userErrorMessage(userErrors = []) {
  return userErrors
    .map((error) =>
      error.field?.length
        ? `${error.field.join(".")}: ${error.message}`
        : error.message,
    )
    .join("; ");
}

function isUniqueConstraintError(error) {
  return error && typeof error === "object" && error.code === "P2002";
}

async function adminGraphql(shop, accessToken, query, variables = {}) {
  const response = await fetch(
    `https://${shop}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({ query, variables }),
    },
  );
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(
      `Shopify GraphQL HTTP ${response.status}: ${JSON.stringify(payload)}`,
    );
  }

  if (payload.errors?.length) {
    throw new Error(
      payload.errors
        .map((error) => error.message || "Unknown GraphQL error")
        .join("; "),
    );
  }

  return payload.data;
}

function summarizeCycle(cycle) {
  const attempt = cycle.billingAttempts?.nodes?.[0] ?? null;
  const processingError = attempt?.processingError;

  return {
    contractId: cycle.sourceContract?.id ?? null,
    cycleIndex: cycle.cycleIndex,
    expectedAt: cycle.billingAttemptExpectedDate,
    status: cycle.status,
    skipped: Boolean(cycle.skipped),
    attemptId: attempt?.id ?? null,
    orderName: attempt?.order?.name ?? null,
    error: processingError?.message ?? attempt?.errorMessage ?? null,
    errorCode: processingError?.code ?? attempt?.errorCode ?? null,
  };
}

async function collectBulkResults(session, jobId) {
  const results = [];
  let after = null;

  do {
    const data = await adminGraphql(
      session.shop,
      session.accessToken,
      BULK_RESULTS_QUERY,
      { jobId, first: 250, after },
    );
    const connection = data.subscriptionBillingCycleBulkResults;
    results.push(...(connection.nodes ?? []).map(summarizeCycle));
    after = connection.pageInfo?.hasNextPage
      ? connection.pageInfo.endCursor
      : null;
  } while (after);

  const chargedCount = results.filter((result) => result.orderName).length;
  const failedCount = results.filter((result) => result.error).length;

  return {
    targetedCount: results.length,
    chargedCount,
    failedCount,
    cycles: results,
  };
}

async function pollRunningRuns(session) {
  const runningRuns = await prisma.subscriptionRenewalRun.findMany({
    where: {
      shop: session.shop,
      status: "RUNNING",
      jobId: { not: null },
    },
    orderBy: { createdAt: "asc" },
  });

  for (const run of runningRuns) {
    try {
      const data = await adminGraphql(session.shop, session.accessToken, JOB_QUERY, {
        id: run.jobId,
      });

      if (!data.job?.done) continue;

      const summary = await collectBulkResults(session, run.jobId);
      await prisma.subscriptionRenewalRun.update({
        where: { id: run.id },
        data: {
          status: "DONE",
          resultSummary: JSON.stringify(summary),
          errorMessage: null,
        },
      });
    } catch (error) {
      await prisma.subscriptionRenewalRun.update({
        where: { id: run.id },
        data: {
          status: "ERROR",
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }
}

async function hasRecentRunningRun(shop) {
  const cutoff = new Date(Date.now() - RUNNING_LOCK_MS);
  const runningRun = await prisma.subscriptionRenewalRun.findFirst({
    where: {
      shop,
      status: "RUNNING",
      createdAt: { gte: cutoff },
    },
  });

  return Boolean(runningRun);
}

async function createRenewalRun(shop, windowStart, windowEnd) {
  const idempotencyKey = `${shop}:${windowStart.toISOString()}:${windowEnd.toISOString()}`;

  try {
    return await prisma.subscriptionRenewalRun.create({
      data: {
        shop,
        idempotencyKey,
        windowStart,
        windowEnd,
        status: "PENDING",
      },
    });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;

    return prisma.subscriptionRenewalRun.findUnique({
      where: { idempotencyKey },
    });
  }
}

async function chargeRenewalWindow(session) {
  if (await hasRecentRunningRun(session.shop)) {
    return;
  }

  const { windowStart, windowEnd } = renewalWindow();
  const run = await createRenewalRun(session.shop, windowStart, windowEnd);
  if (!run || run.status !== "PENDING") {
    return;
  }

  try {
    const data = await adminGraphql(
      session.shop,
      session.accessToken,
      BULK_CHARGE_MUTATION,
      {
        startDate: windowStart.toISOString(),
        endDate: windowEnd.toISOString(),
        filters: {
          contractStatus: ["ACTIVE"],
          billingCycleStatus: ["UNBILLED"],
          billingAttemptStatus: "NO_ATTEMPT",
        },
      },
    );
    const payload = data.subscriptionBillingCycleBulkCharge;
    const userErrors = userErrorMessage(payload.userErrors);
    if (userErrors) throw new Error(userErrors);

    await prisma.subscriptionRenewalRun.update({
      where: { id: run.id },
      data: {
        status: "RUNNING",
        jobId: payload.job?.id ?? null,
      },
    });
  } catch (error) {
    await prisma.subscriptionRenewalRun.update({
      where: { id: run.id },
      data: {
        status: "ERROR",
        errorMessage: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

export async function runSubscriptionWorkerOnce() {
  const sessions = await prisma.session.findMany({
    where: {
      isOnline: false,
      accessToken: { not: "" },
    },
    orderBy: { shop: "asc" },
  });

  for (const session of sessions) {
    await pollRunningRuns(session);
    await chargeRenewalWindow(session);
    await runSnapshotPass(session);
  }
}

export function startSubscriptionWorker() {
  if (!isWorkerEnabled()) return;

  const intervalMs = numberEnv(
    "SUBSCRIPTION_WORKER_INTERVAL_MS",
    DEFAULT_INTERVAL_MS,
  );
  const tick = () => {
    runSubscriptionWorkerOnce().catch((error) => {
      console.error("[subscription-worker] run failed", error);
    });
  };

  setTimeout(tick, 1000).unref?.();
  setInterval(tick, intervalMs).unref?.();
}

if (process.argv.includes("--once")) {
  runSubscriptionWorkerOnce()
    .catch((error) => {
      console.error("[subscription-worker] run failed", error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const API_VERSION = process.env.SHOPIFY_SUBSCRIPTION_API_VERSION || "2026-04";
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_LOOKBACK_HOURS = 24;
const DEFAULT_LEAD_HOURS = 24;
const RUNNING_LOCK_MS = 2 * 60 * 60 * 1000;

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

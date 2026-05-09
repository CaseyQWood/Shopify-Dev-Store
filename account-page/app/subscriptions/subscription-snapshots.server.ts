/**
 * subscription-snapshots.server.ts
 *
 * Capture, list, and restore SubscriptionSnapshot records.
 *
 * Capture: serialises the Shopify contract + billing-cycle data into a row.
 *          Idempotent on (shop, contractId, snapshotAt) — duplicate writes are
 *          silently swallowed.
 *
 * List:    returns pending (isRestored=false) snapshots for the given shop,
 *          most recent first.
 *
 * Restore: re-applies app-managed config only — does NOT mutate Shopify
 *          contracts. Marks isRestored=true and stamps restoredAt.
 */

import type { PrismaClient } from "@prisma/client";

import type { AdminGraphqlClient } from "./shopify-graphql.server";
import {
  normalizeGid,
  shopifyGraphql,
} from "./shopify-graphql.server";
import { recordSubscriptionAdminAction } from "./subscription-contracts.server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SnapshotView = {
  id: string;
  contractId: string;
  customerId: string | null;
  snapshotAt: string;
  isRestored: boolean;
  restoredAt: string | null;
  createdAt: string;
  /** Parsed summary from contractData for display purposes */
  contractSummary: {
    status: string | null;
    customerDisplayName: string | null;
    lineSummary: string | null;
  };
};

// ---------------------------------------------------------------------------
// GraphQL query — mirrors CONTRACT_DETAIL_QUERY shape from
// subscription-contracts.server.ts but inlined here so this module is
// self-contained (avoids exporting internals from the contracts module).
// ---------------------------------------------------------------------------

const NEXT_CYCLE_LOOKAHEAD_DAYS = 730;
const SHOPIFY_TIME_ZONE = "Z";

function dateRangeFromNow(days: number) {
  const now = new Date();
  const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  return {
    cycleStart: now.toISOString().replace("Z", SHOPIFY_TIME_ZONE),
    cycleEnd: end.toISOString().replace("Z", SHOPIFY_TIME_ZONE),
  };
}

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
` as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "P2002"
  );
}

function truncateLines(
  nodes: Array<{ title?: string | null; quantity?: number | null }> | null | undefined,
): string | null {
  if (!nodes || nodes.length === 0) return null;
  const [first, ...rest] = nodes;
  const suffix = rest.length > 0 ? ` + ${rest.length} more` : "";
  return `${first.quantity ?? 1} x ${first.title ?? "Untitled"}${suffix}`;
}

// ---------------------------------------------------------------------------
// captureSnapshot
// ---------------------------------------------------------------------------

/**
 * Fetch the current state of a contract from Shopify and persist a snapshot
 * row. Idempotent: if a row already exists for (shop, contractId, snapshotAt)
 * the duplicate is silently ignored and `null` is returned.
 *
 * Returns the created snapshot id, or `null` on a duplicate.
 */
export async function captureSnapshot(
  prisma: PrismaClient,
  admin: AdminGraphqlClient,
  shop: string,
  contractId: string,
): Promise<string | null> {
  const normalizedId = normalizeGid(contractId, "SubscriptionContract");
  const snapshotAt = new Date();
  snapshotAt.setUTCSeconds(0, 0); // truncate to minute for idempotency window

  type SnapshotQueryData = {
    subscriptionContract: Record<string, unknown> | null;
    subscriptionBillingCycles: { nodes?: unknown[] | null };
  };

  const data = await shopifyGraphql<SnapshotQueryData>(
    admin,
    SNAPSHOT_CONTRACT_QUERY,
    {
      id: normalizedId,
      ...dateRangeFromNow(NEXT_CYCLE_LOOKAHEAD_DAYS),
    },
  );

  const contract = data.subscriptionContract;
  if (!contract) {
    throw new Error(
      `Contract ${contractId} not found in Shopify — snapshot aborted.`,
    );
  }

  const customerId =
    (contract.customer as { id?: string } | null)?.id ?? null;

  const contractData = JSON.stringify(contract);
  const billingCycles = JSON.stringify(
    data.subscriptionBillingCycles.nodes ?? [],
  );
  const billingMetadata = JSON.stringify({
    lastPaymentStatus: (contract as Record<string, unknown>).lastPaymentStatus ?? null,
    lastBillingAttemptErrorType:
      (contract as Record<string, unknown>).lastBillingAttemptErrorType ?? null,
    billingPolicy: (contract as Record<string, unknown>).billingPolicy ?? null,
    deliveryPolicy: (contract as Record<string, unknown>).deliveryPolicy ?? null,
    capturedAt: snapshotAt.toISOString(),
  });

  try {
    const row = await prisma.subscriptionSnapshot.create({
      data: {
        shop,
        contractId: normalizedId,
        customerId,
        snapshotAt,
        contractData,
        billingCycles,
        billingMetadata,
      },
    });

    await recordSubscriptionAdminAction(prisma, {
      shop,
      action: "snapshot.captured",
      contractId: normalizedId,
      targetId: row.id,
      status: "SUCCESS",
      message: `Snapshot ${row.id} captured.`,
    });

    return row.id;
  } catch (err) {
    if (isUniqueConstraintError(err)) return null;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// listPendingSnapshots
// ---------------------------------------------------------------------------

/**
 * Returns all unreconciled snapshots for a shop, most recent first.
 */
export async function listPendingSnapshots(
  prisma: PrismaClient,
  shop: string,
): Promise<SnapshotView[]> {
  const rows = await prisma.subscriptionSnapshot.findMany({
    where: { shop, isRestored: false },
    orderBy: { snapshotAt: "desc" },
  });

  return rows.map((row) => {
    let contractSummary: SnapshotView["contractSummary"] = {
      status: null,
      customerDisplayName: null,
      lineSummary: null,
    };

    try {
      const parsed = JSON.parse(row.contractData) as {
        status?: string | null;
        customer?: { displayName?: string | null } | null;
        lines?: { nodes?: Array<{ title?: string | null; quantity?: number | null }> | null } | null;
      };
      contractSummary = {
        status: parsed.status ?? null,
        customerDisplayName: parsed.customer?.displayName ?? null,
        lineSummary: truncateLines(parsed.lines?.nodes),
      };
    } catch {
      // contractData is malformed — surface blank summary rather than crash
    }

    return {
      id: row.id,
      contractId: row.contractId,
      customerId: row.customerId,
      snapshotAt: row.snapshotAt.toISOString(),
      isRestored: row.isRestored,
      restoredAt: row.restoredAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      contractSummary,
    };
  });
}

// ---------------------------------------------------------------------------
// restoreFromSnapshot
// ---------------------------------------------------------------------------

/**
 * Re-applies app-managed config for the contract referenced by a snapshot.
 *
 * This function intentionally does NOT mutate the Shopify contract — Shopify
 * is the source of truth for contract data. What "restore" means here is:
 *   1. Verify the snapshot row exists and is not already restored.
 *   2. Re-run any app-side idempotent setup (e.g., selling-plan attachment)
 *      that might have been lost during an uninstall. Currently this is a
 *      no-op placeholder because the app does not store contract-level app
 *      metadata beyond what Shopify holds — extend this function as new
 *      app-managed state is introduced.
 *   3. Mark isRestored=true and stamp restoredAt.
 *   4. Write an audit row.
 */
export async function restoreFromSnapshot(
  prisma: PrismaClient,
  shop: string,
  snapshotId: string,
  adminEmail?: string | null,
): Promise<{ restored: boolean; message: string }> {
  const snapshot = await prisma.subscriptionSnapshot.findUnique({
    where: { id: snapshotId },
  });

  if (!snapshot) {
    throw new Error(`Snapshot ${snapshotId} not found.`);
  }
  if (snapshot.shop !== shop) {
    throw new Error("Snapshot does not belong to this shop.");
  }
  if (snapshot.isRestored) {
    return { restored: false, message: "Snapshot was already reconciled." };
  }

  // --- App-managed restore logic goes here. ---
  // Currently the app stores no contract-level metadata beyond what Shopify
  // already holds. As new app-managed fields are introduced, add their
  // re-application logic here.
  // ---

  const restoredAt = new Date();
  await prisma.subscriptionSnapshot.update({
    where: { id: snapshotId },
    data: { isRestored: true, restoredAt },
  });

  await recordSubscriptionAdminAction(prisma, {
    shop,
    adminEmail,
    action: "snapshot.restored",
    contractId: snapshot.contractId,
    targetId: snapshotId,
    status: "SUCCESS",
    message: `Snapshot ${snapshotId} reconciled for contract ${snapshot.contractId}.`,
  });

  return { restored: true, message: "Snapshot reconciled successfully." };
}

// ---------------------------------------------------------------------------
// pruneOldSnapshots
// ---------------------------------------------------------------------------

const DEFAULT_RETENTION_DAYS = 90;

/**
 * Deletes snapshots older than SUBSCRIPTION_SNAPSHOT_RETENTION_DAYS (default
 * 90) that have already been restored. Unremedied (isRestored=false) snapshots
 * are never pruned so they remain available for reconciliation.
 *
 * Returns the number of rows deleted.
 */
export async function pruneOldSnapshots(
  prisma: PrismaClient,
  shop: string,
): Promise<number> {
  const retentionDays =
    parseInt(process.env.SUBSCRIPTION_SNAPSHOT_RETENTION_DAYS ?? "", 10) ||
    DEFAULT_RETENTION_DAYS;

  const cutoff = new Date(
    Date.now() - retentionDays * 24 * 60 * 60 * 1000,
  );

  const result = await prisma.subscriptionSnapshot.deleteMany({
    where: {
      shop,
      isRestored: true,
      createdAt: { lt: cutoff },
    },
  });

  if (result.count > 0) {
    await recordSubscriptionAdminAction(prisma, {
      shop,
      action: "snapshot.pruned",
      status: "SUCCESS",
      message: `Pruned ${result.count} snapshot(s) older than ${retentionDays} days.`,
      metadata: { count: result.count, retentionDays, cutoff: cutoff.toISOString() },
    });
  }

  return result.count;
}

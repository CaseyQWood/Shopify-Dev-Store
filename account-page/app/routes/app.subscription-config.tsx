import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, redirect, useActionData, useLoaderData, useNavigate, useRouteError } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import {
  listSellingPlanGroups,
  getSellingPlanGroupDetail,
  createSellingPlanGroup,
  updateSellingPlanGroupBasics,
  updateSellingPlanGroupPlans,
  addProductsToGroup,
  removeProductsFromGroup,
} from "../subscriptions/selling-plans.server";
import type {
  SellingPlanGroupSummary,
  SellingPlanGroupDetail,
} from "../subscriptions/selling-plans.server";
import {
  formatShopifyError,
} from "../subscriptions/shopify-graphql.server";
import { recordSubscriptionAdminAction } from "../subscriptions/subscription-contracts.server";
import {
  listPendingSnapshots,
  restoreFromSnapshot,
} from "../subscriptions/subscription-snapshots.server";
import type { SnapshotView } from "../subscriptions/subscription-snapshots.server";
import { GroupBasicsForm } from "../components/GroupBasicsForm";
import { PlansTable } from "../components/PlansTable";
import { ProductCardList } from "../components/ProductCardList";
import styles from "../styles/subscription-admin.module.css";

const REQUIRED_SUBSCRIPTION_SCOPES = [
  "read_customers",
  "read_customer_payment_methods",
  "read_own_subscription_contracts",
  "write_own_subscription_contracts",
];

type ActionResult = {
  status: "success" | "error";
  message: string;
};

type SessionWithAdminEmail = {
  shop: string;
  email?: string | null;
};

type RenewalRunView = {
  id: string;
  status: string;
  jobId: string | null;
  windowStart: string;
  windowEnd: string;
  errorMessage: string | null;
  createdAt: string;
};

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function formatDateTime(iso: string | null) {
  if (!iso) return "Not available";

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const { shop } = session as SessionWithAdminEmail;

  const url = new URL(request.url);
  const groupId = url.searchParams.get("groupId");

  let groups: SellingPlanGroupSummary[] = [];
  let selectedGroup: SellingPlanGroupDetail | null = null;
  let sellingPlanError: string | null = null;

  try {
    groups = await listSellingPlanGroups(admin);
    if (groupId) {
      selectedGroup = await getSellingPlanGroupDetail(admin, groupId);
    }
  } catch (error) {
    sellingPlanError = formatShopifyError(error);
  }

  const recentRenewalRuns = await prisma.subscriptionRenewalRun.findMany({
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  const pendingSnapshots = await listPendingSnapshots(prisma, shop);

  return {
    groups,
    selectedGroup,
    sellingPlanError,
    requiredScopes: REQUIRED_SUBSCRIPTION_SCOPES,
    workerEnabled: process.env.SUBSCRIPTION_WORKER_ENABLED === "true",
    snapshotsEnabled: process.env.SUBSCRIPTION_SNAPSHOTS_ENABLED === "true",
    recentRenewalRuns: recentRenewalRuns.map((run) => ({
      id: run.id,
      status: run.status,
      jobId: run.jobId,
      windowStart: run.windowStart.toISOString(),
      windowEnd: run.windowEnd.toISOString(),
      errorMessage: run.errorMessage,
      createdAt: run.createdAt.toISOString(),
    })),
    pendingSnapshots,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const { shop, email } = session as SessionWithAdminEmail;
  const formData = await request.formData();
  const intent = formString(formData, "intent");

  try {
    switch (intent) {
      case "create-group": {
        const name = formString(formData, "name");
        if (!name) {
          return { status: "error", message: "Missing required field: name." } satisfies ActionResult;
        }
        const description = formString(formData, "description") || undefined;
        const newGroupId = await createSellingPlanGroup(admin, { name, description });
        await recordSubscriptionAdminAction(prisma, {
          shop,
          adminEmail: email,
          action: "CREATE_SELLING_PLAN_GROUP",
          targetId: newGroupId,
          status: "SUCCESS",
          metadata: { name },
        });
        return redirect(`?groupId=${encodeURIComponent(newGroupId)}`);
      }

      case "update-group-basics": {
        const groupId = formString(formData, "groupId");
        const name = formString(formData, "name");
        if (!groupId) {
          return { status: "error", message: "Missing required field: groupId." } satisfies ActionResult;
        }
        if (!name) {
          return { status: "error", message: "Missing required field: name." } satisfies ActionResult;
        }
        const description = formString(formData, "description") || undefined;
        await updateSellingPlanGroupBasics(admin, groupId, { name, description });
        await recordSubscriptionAdminAction(prisma, {
          shop,
          adminEmail: email,
          action: "UPDATE_SELLING_PLAN_GROUP_BASICS",
          targetId: groupId,
          status: "SUCCESS",
          metadata: { name },
        });
        return { status: "success", message: "Group details updated." } satisfies ActionResult;
      }

      case "add-products": {
        const groupId = formString(formData, "groupId");
        const productIdsInput = formString(formData, "productIdsInput");
        if (!groupId) {
          return { status: "error", message: "Missing required field: groupId." } satisfies ActionResult;
        }
        if (!productIdsInput) {
          return { status: "error", message: "Missing required field: productIdsInput." } satisfies ActionResult;
        }
        const productIds = productIdsInput
          .split("\n")
          .map((id) => id.trim())
          .filter(Boolean);
        await addProductsToGroup(admin, groupId, productIds);
        await recordSubscriptionAdminAction(prisma, {
          shop,
          adminEmail: email,
          action: "ADD_PRODUCTS_TO_GROUP",
          targetId: groupId,
          status: "SUCCESS",
          metadata: { productIds },
        });
        return { status: "success", message: `${productIds.length} product(s) added.` } satisfies ActionResult;
      }

      case "remove-product": {
        const groupId = formString(formData, "groupId");
        const productId = formString(formData, "productId");
        if (!groupId) {
          return { status: "error", message: "Missing required field: groupId." } satisfies ActionResult;
        }
        if (!productId) {
          return { status: "error", message: "Missing required field: productId." } satisfies ActionResult;
        }
        await removeProductsFromGroup(admin, groupId, [productId]);
        await recordSubscriptionAdminAction(prisma, {
          shop,
          adminEmail: email,
          action: "REMOVE_PRODUCT_FROM_GROUP",
          targetId: groupId,
          status: "SUCCESS",
          metadata: { productId },
        });
        return { status: "success", message: "Product removed from group." } satisfies ActionResult;
      }

      case "update-plan": {
        const groupId = formString(formData, "groupId");
        const planId = formString(formData, "planId");
        const name = formString(formData, "name");
        const interval = formString(formData, "interval") as "WEEK" | "MONTH";
        const intervalCountRaw = formString(formData, "intervalCount");
        if (!groupId || !planId || !name || !interval || !intervalCountRaw) {
          return {
            status: "error",
            message: "Missing required fields: groupId, planId, name, interval, intervalCount.",
          } satisfies ActionResult;
        }
        const intervalCount = parseInt(intervalCountRaw, 10);
        if (isNaN(intervalCount) || intervalCount < 1) {
          return { status: "error", message: "intervalCount must be a positive integer." } satisfies ActionResult;
        }
        await updateSellingPlanGroupPlans(admin, groupId, {
          plansToUpdate: [{ id: planId, name, interval, intervalCount }],
        });
        await recordSubscriptionAdminAction(prisma, {
          shop,
          adminEmail: email,
          action: "UPDATE_SELLING_PLAN",
          targetId: groupId,
          status: "SUCCESS",
          metadata: { planId, name, interval, intervalCount },
        });
        return { status: "success", message: "Plan updated." } satisfies ActionResult;
      }

      case "add-plan": {
        const groupId = formString(formData, "groupId");
        const name = formString(formData, "name");
        const interval = formString(formData, "interval") as "WEEK" | "MONTH";
        const intervalCountRaw = formString(formData, "intervalCount");
        if (!groupId || !name || !interval || !intervalCountRaw) {
          return {
            status: "error",
            message: "Missing required fields: groupId, name, interval, intervalCount.",
          } satisfies ActionResult;
        }
        const intervalCount = parseInt(intervalCountRaw, 10);
        if (isNaN(intervalCount) || intervalCount < 1) {
          return { status: "error", message: "intervalCount must be a positive integer." } satisfies ActionResult;
        }
        await updateSellingPlanGroupPlans(admin, groupId, {
          plansToCreate: [{ name, interval, intervalCount }],
        });
        await recordSubscriptionAdminAction(prisma, {
          shop,
          adminEmail: email,
          action: "ADD_SELLING_PLAN",
          targetId: groupId,
          status: "SUCCESS",
          metadata: { name, interval, intervalCount },
        });
        return { status: "success", message: "Plan added." } satisfies ActionResult;
      }

      case "remove-plan": {
        const groupId = formString(formData, "groupId");
        const planId = formString(formData, "planId");
        if (!groupId) {
          return { status: "error", message: "Missing required field: groupId." } satisfies ActionResult;
        }
        if (!planId) {
          return { status: "error", message: "Missing required field: planId." } satisfies ActionResult;
        }
        await updateSellingPlanGroupPlans(admin, groupId, {
          plansToDelete: [planId],
        });
        await recordSubscriptionAdminAction(prisma, {
          shop,
          adminEmail: email,
          action: "REMOVE_SELLING_PLAN",
          targetId: groupId,
          status: "SUCCESS",
          metadata: { planId },
        });
        return { status: "success", message: "Plan removed." } satisfies ActionResult;
      }

      case "restore-snapshot": {
        const snapshotId = formString(formData, "snapshotId");
        if (!snapshotId) throw new Error("Missing snapshotId.");
        const result = await restoreFromSnapshot(prisma, shop, snapshotId, email);
        return {
          status: "success",
          message: result.message,
        } satisfies ActionResult;
      }

      default:
        throw new Error("Unknown subscription admin action.");
    }
  } catch (error) {
    const message = formatShopifyError(error);
    await recordSubscriptionAdminAction(prisma, {
      shop,
      adminEmail: email,
      action: intent,
      status: "ERROR",
      message,
    });

    return { status: "error", message } satisfies ActionResult;
  }
};

function GroupEditor({
  group,
}: {
  group: SellingPlanGroupDetail;
}) {
  return (
    <div className={styles.stack}>
      <GroupBasicsForm
        groupId={group.id}
        name={group.name}
        description={group.description}
        merchantCode={group.merchantCode}
      />
      <ProductCardList groupId={group.id} products={group.products.nodes} />
      <PlansTable groupId={group.id} plans={group.sellingPlans.nodes} />
    </div>
  );
}

function GroupPicker({
  groups,
  selectedGroupId,
}: {
  groups: SellingPlanGroupSummary[];
  selectedGroupId: string | undefined;
}) {
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);

  function handleSelectChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    const params = new URLSearchParams(window.location.search);
    if (value) {
      params.set("groupId", value);
    } else {
      params.delete("groupId");
    }
    navigate(`?${params.toString()}`);
  }

  return (
    <div className={styles.groupPickerRow}>
      <div className={styles.pickerField}>
        <span className={styles.pickerLabel}>Selling plan group</span>
        <select
          value={selectedGroupId ?? ""}
          onChange={handleSelectChange}
          style={{ minHeight: 36, borderRadius: 6, border: "1px solid #c9cccf", padding: "6px 10px", font: "inherit", fontSize: "0.95rem" }}
        >
          <option value="">— Select a group —</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name} — {g.merchantCode}
            </option>
          ))}
        </select>
      </div>

      <div>
        {!showCreate ? (
          <button
            type="button"
            className={styles.pickerButton}
            onClick={() => setShowCreate(true)}
          >
            + Create new group
          </button>
        ) : (
          <Form method="post" className={styles.modalForm} style={{ border: "1px solid #dfe3e8", borderRadius: 8, marginTop: 8 }}>
            <h3>New selling plan group</h3>
            <input type="hidden" name="intent" value="create-group" />
            <div className={styles.field}>
              <span>Name *</span>
              <input type="text" name="name" required placeholder="e.g. Monthly subscriptions" />
            </div>
            <div className={styles.field}>
              <span>Description (optional)</span>
              <textarea name="description" placeholder="Brief description shown to customers" />
            </div>
            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.pickerButton}
                onClick={() => setShowCreate(false)}
              >
                Cancel
              </button>
              <button type="submit" className={styles.button}>
                Create group
              </button>
            </div>
          </Form>
        )}
      </div>
    </div>
  );
}

function SellingPlanSetup({
  groups,
  selectedGroup,
  error,
}: {
  groups: SellingPlanGroupSummary[];
  selectedGroup: SellingPlanGroupDetail | null;
  error: string | null;
}) {

  return (
    <s-section heading="Subscription purchase options">
      <GroupPicker groups={groups} selectedGroupId={selectedGroup?.id} />
      {error ? <div className={styles.errorBox}>{error}</div> : null}
      {selectedGroup ? (
        <GroupEditor group={selectedGroup} />
      ) : (
        <div className={styles.setupStatus}>
          <span className={styles.badgeWarning}>Not configured</span>
          <span>Select or create a selling plan group above to get started.</span>
        </div>
      )}
    </s-section>
  );
}

function RenewalRuns({
  runs,
  workerEnabled,
}: {
  runs: RenewalRunView[];
  workerEnabled: boolean;
}) {
  return (
    <s-section heading="Renewal worker">
      <div className={styles.setupStatus}>
        <span className={workerEnabled ? styles.badgeSuccess : styles.badge}>
          {workerEnabled ? "Enabled" : "Disabled"}
        </span>
        <span>Set SUBSCRIPTION_WORKER_ENABLED=true to run with the web process.</span>
      </div>
      {runs.length === 0 ? (
        <div className={styles.emptyState}>No renewal runs recorded.</div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Created</th>
                <th scope="col">Status</th>
                <th scope="col">Window</th>
                <th scope="col">Job</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id}>
                  <td>{formatDateTime(run.createdAt)}</td>
                  <td>{run.errorMessage ?? run.status}</td>
                  <td>
                    {formatDateTime(run.windowStart)} to {" "}
                    {formatDateTime(run.windowEnd)}
                  </td>
                  <td>{run.jobId ?? "No job"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </s-section>
  );
}

function SnapshotReconcile({
  snapshots,
  snapshotsEnabled,
}: {
  snapshots: SnapshotView[];
  snapshotsEnabled: boolean;
}) {
  return (
    <s-section heading="Pending snapshots to reconcile">
      <div className={styles.setupStatus}>
        <span className={snapshotsEnabled ? styles.badgeSuccess : styles.badge}>
          {snapshotsEnabled ? "Snapshots enabled" : "Snapshots disabled"}
        </span>
        <span>Set SUBSCRIPTION_SNAPSHOTS_ENABLED=true to enable periodic snapshots.</span>
      </div>
      {snapshots.length === 0 ? (
        <div className={styles.emptyState}>
          No pending snapshots to reconcile.
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Contract</th>
                <th scope="col">Customer</th>
                <th scope="col">Snapshot taken</th>
                <th scope="col">Status</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map((snap) => (
                <tr key={snap.id}>
                  <td>
                    <span className={styles.idLink}>
                      {snap.contractId.replace(
                        "gid://shopify/SubscriptionContract/",
                        "#",
                      )}
                    </span>
                    {snap.contractSummary.lineSummary ? (
                      <div className={styles.muted} style={{ fontSize: "0.82rem" }}>
                        {snap.contractSummary.lineSummary}
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <div className={styles.customerCell}>
                      <span>
                        {snap.contractSummary.customerDisplayName ?? "Unknown"}
                      </span>
                    </div>
                  </td>
                  <td>{formatDateTime(snap.snapshotAt)}</td>
                  <td>
                    <span
                      className={
                        snap.contractSummary.status === "ACTIVE"
                          ? styles.badgeSuccess
                          : styles.badge
                      }
                    >
                      {snap.contractSummary.status ?? "Unknown"}
                    </span>
                  </td>
                  <td>
                    <Form method="post">
                      <input type="hidden" name="intent" value="restore-snapshot" />
                      <input type="hidden" name="snapshotId" value={snap.id} />
                      <button type="submit" className={styles.button}>
                        Reconcile
                      </button>
                    </Form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </s-section>
  );
}

export default function SubscriptionConfigPage() {
  const {
    sellingPlanError,
    groups,
    selectedGroup,
    recentRenewalRuns,
    workerEnabled,
    snapshotsEnabled,
    pendingSnapshots,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const shopify = useAppBridge();

  useEffect(() => {
    if (actionData?.message) {
      shopify.toast.show(actionData.message, {
        isError: actionData.status === "error",
      });
    }
  }, [actionData, shopify]);

  return (
    <s-page heading="Subscription config">
      {actionData ? (
        <s-section>
          <div
            className={
              actionData.status === "success" ? styles.successBox : styles.errorBox
            }
          >
            {actionData.message}
          </div>
        </s-section>
      ) : null}

      <SellingPlanSetup groups={groups} selectedGroup={selectedGroup} error={sellingPlanError} />
      <RenewalRuns runs={recentRenewalRuns} workerEnabled={workerEnabled} />
      <SnapshotReconcile snapshots={pendingSnapshots} snapshotsEnabled={snapshotsEnabled} />
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

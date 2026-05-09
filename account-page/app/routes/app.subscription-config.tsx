import { useEffect, useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, useActionData, useLoaderData, useRouteError } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import {
  getSubscriptionSellingPlanGroup,
  setupSubscriptionSellingPlans,
} from "../subscriptions/selling-plans.server";
import {
  formatShopifyError,
} from "../subscriptions/shopify-graphql.server";
import { recordSubscriptionAdminAction } from "../subscriptions/subscription-contracts.server";
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
  const { admin } = await authenticate.admin(request);

  let sellingPlanGroup: Awaited<
    ReturnType<typeof getSubscriptionSellingPlanGroup>
  > = null;
  let sellingPlanError: string | null = null;

  try {
    sellingPlanGroup = await getSubscriptionSellingPlanGroup(admin);
  } catch (error) {
    sellingPlanError = formatShopifyError(error);
  }

  const recentRenewalRuns = await prisma.subscriptionRenewalRun.findMany({
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  return {
    sellingPlanGroup,
    sellingPlanError,
    requiredScopes: REQUIRED_SUBSCRIPTION_SCOPES,
    workerEnabled: process.env.SUBSCRIPTION_WORKER_ENABLED === "true",
    recentRenewalRuns: recentRenewalRuns.map((run) => ({
      id: run.id,
      status: run.status,
      jobId: run.jobId,
      windowStart: run.windowStart.toISOString(),
      windowEnd: run.windowEnd.toISOString(),
      errorMessage: run.errorMessage,
      createdAt: run.createdAt.toISOString(),
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const { shop, email } = session as SessionWithAdminEmail;
  const formData = await request.formData();
  const intent = formString(formData, "intent");

  try {
    switch (intent) {
      case "setup-selling-plans": {
        const result = await setupSubscriptionSellingPlans(admin, {
          productIdsInput: formString(formData, "productIdsInput"),
          productVariantIdsInput: formString(formData, "productVariantIdsInput"),
        });
        await recordSubscriptionAdminAction(prisma, {
          shop,
          adminEmail: email,
          action: "SETUP_SELLING_PLANS",
          targetId: result.sellingPlanGroupId,
          status: "SUCCESS",
          metadata: result,
        });
        return {
          status: "success",
          message: result.created
            ? "Subscription selling plan group was created and attached."
            : "Subscription selling plan group was updated and attached.",
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
      action: "SETUP_SELLING_PLANS",
      status: "ERROR",
      message,
    });

    return { status: "error", message } satisfies ActionResult;
  }
};

type PickedItem = { id: string; title: string };

function SellingPlanSetup({
  group,
  error,
}: {
  group: Awaited<ReturnType<typeof getSubscriptionSellingPlanGroup>>;
  error: string | null;
}) {
  const shopify = useAppBridge();
  const [products, setProducts] = useState<PickedItem[]>([]);
  const [variants, setVariants] = useState<PickedItem[]>([]);

  async function openProductPicker() {
    const selection = await shopify.resourcePicker({
      type: "product",
      multiple: true,
      action: "select",
      selectionIds: products.map((p) => ({ id: p.id })),
    });
    if (selection) {
      setProducts(
        selection.map((p) => ({ id: p.id, title: p.title })),
      );
    }
  }

  async function openVariantPicker() {
    const selection = await shopify.resourcePicker({
      type: "variant",
      multiple: true,
      action: "select",
      selectionIds: variants.map((v) => ({ id: v.id })),
    });
    if (selection) {
      setVariants(
        selection.map((v) => ({
          id: v.id,
          title: v.displayName ?? v.id,
        })),
      );
    }
  }

  function removeProduct(id: string) {
    setProducts((prev) => prev.filter((p) => p.id !== id));
  }

  function removeVariant(id: string) {
    setVariants((prev) => prev.filter((v) => v.id !== id));
  }

  return (
    <s-section heading="Subscription purchase options">
      {error ? <div className={styles.errorBox}>{error}</div> : null}
      <div className={styles.setupStatus}>
        <span className={group ? styles.badgeSuccess : styles.badgeWarning}>
          {group ? "Configured" : "Not configured"}
        </span>
        {group ? <span>{group.id}</span> : null}
      </div>
      <Form method="post" className={styles.stack}>
        <input type="hidden" name="intent" value="setup-selling-plans" />
        <input
          type="hidden"
          name="productIdsInput"
          value={products.map((p) => p.id).join("\n")}
        />
        <input
          type="hidden"
          name="productVariantIdsInput"
          value={variants.map((v) => v.id).join("\n")}
        />

        <div className={styles.pickerField}>
          <span className={styles.pickerLabel}>Products</span>
          <button
            type="button"
            className={styles.pickerButton}
            onClick={openProductPicker}
          >
            Select products
          </button>
          {products.length > 0 && (
            <div className={styles.chipList}>
              {products.map((p) => (
                <span key={p.id} className={styles.chip}>
                  {p.title}
                  <button
                    type="button"
                    className={styles.chipRemove}
                    aria-label={`Remove ${p.title}`}
                    onClick={() => removeProduct(p.id)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className={styles.pickerField}>
          <span className={styles.pickerLabel}>Product variants</span>
          <button
            type="button"
            className={styles.pickerButton}
            onClick={openVariantPicker}
          >
            Select variants
          </button>
          {variants.length > 0 && (
            <div className={styles.chipList}>
              {variants.map((v) => (
                <span key={v.id} className={styles.chip}>
                  {v.title}
                  <button
                    type="button"
                    className={styles.chipRemove}
                    aria-label={`Remove ${v.title}`}
                    onClick={() => removeVariant(v.id)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <button type="submit" className={styles.button}>
          Upsert monthly and bi-weekly plans
        </button>
      </Form>
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

export default function SubscriptionConfigPage() {
  const {
    sellingPlanError,
    sellingPlanGroup,
    requiredScopes,
    recentRenewalRuns,
    workerEnabled,
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

      <SellingPlanSetup group={sellingPlanGroup} error={sellingPlanError} />
      <RenewalRuns runs={recentRenewalRuns} workerEnabled={workerEnabled} />

      <s-section slot="aside" heading="Access requirements">
        <div className={styles.stack}>
          <p className={styles.muted}>
            Shopify remains the subscription source of truth. Checkout creates
            subscription contracts; this console edits contracts and billing cycles
            through Admin GraphQL.
          </p>
          <ul className={styles.scopeList}>
            {requiredScopes.map((scope) => (
              <li key={scope}>{scope}</li>
            ))}
          </ul>
        </div>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

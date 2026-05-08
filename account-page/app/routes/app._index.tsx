import { useEffect } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
  useRouteError,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";

import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import {
  addOneTimeLineToNextCycle,
  addRecurringLine,
  changeNextBillingDate,
  getSubscriptionContractDetail,
  listRecentSubscriptionContracts,
  recordSubscriptionAdminAction,
  removeRecurringLine,
  searchSubscriptionContracts,
  skipNextBillingCycle,
  updateRecurringLine,
  type SubscriptionContract,
} from "../subscriptions/subscription-contracts.server";
import { formatShopifyError } from "../subscriptions/shopify-graphql.server";
import styles from "../styles/subscription-admin.module.css";

type ActionResult = {
  status: "success" | "error";
  message: string;
};

type SessionWithAdminEmail = {
  shop: string;
  email?: string | null;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  const selectedContractId = url.searchParams.get("contractId")?.trim() ?? "";

  let contracts: SubscriptionContract[] = [];
  let selectedContract: SubscriptionContract | null = null;
  let subscriptionError: string | null = null;

  try {
    contracts = query
      ? await searchSubscriptionContracts(admin, query)
      : await listRecentSubscriptionContracts(admin);
  } catch (error) {
    subscriptionError = formatShopifyError(error);
  }

  try {
    selectedContract = selectedContractId
      ? await getSubscriptionContractDetail(admin, selectedContractId)
      : contracts[0]
        ? await getSubscriptionContractDetail(admin, contracts[0].id)
        : null;
  } catch (error) {
    subscriptionError = formatShopifyError(error);
  }

  return {
    query,
    selectedContractId,
    contracts,
    selectedContract,
    subscriptionError,
  };
};

function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function formPositiveInteger(formData: FormData, key: string) {
  const value = Number(formString(formData, key));
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${key} must be a positive whole number.`);
  }

  return value;
}

function buildAddLineInput(formData: FormData) {
  const productVariantId = formString(formData, "productVariantId");
  const currentPrice = formString(formData, "currentPrice");
  if (!productVariantId) throw new Error("Enter a product variant ID.");
  if (!currentPrice) throw new Error("Enter the current price for the line.");

  return {
    contractId: formString(formData, "contractId"),
    productVariantId,
    quantity: formPositiveInteger(formData, "quantity"),
    currentPrice,
  };
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const { shop, email } = session as SessionWithAdminEmail;
  const formData = await request.formData();
  const intent = formString(formData, "intent");
  const contractId = formString(formData, "contractId") || null;
  let actionName = intent || "unknown";

  try {
    switch (intent) {
      case "skip-next-cycle":
        await skipNextBillingCycle(admin, contractId ?? "");
        await recordSubscriptionAdminAction(prisma, {
          shop,
          adminEmail: email,
          action: "SKIP_NEXT_CYCLE",
          contractId,
          status: "SUCCESS",
        });
        return {
          status: "success",
          message: "Next unbilled cycle was skipped.",
        } satisfies ActionResult;

      case "change-next-date":
        await changeNextBillingDate(
          admin,
          contractId ?? "",
          formString(formData, "billingDate"),
        );
        await recordSubscriptionAdminAction(prisma, {
          shop,
          adminEmail: email,
          action: "CHANGE_NEXT_BILLING_DATE",
          contractId,
          status: "SUCCESS",
          metadata: { billingDate: formString(formData, "billingDate") },
        });
        return {
          status: "success",
          message: "Next billing date was changed.",
        } satisfies ActionResult;

      case "update-recurring-line":
        await updateRecurringLine(admin, {
          contractId: contractId ?? "",
          lineId: formString(formData, "lineId"),
          quantity: formPositiveInteger(formData, "quantity"),
          productVariantId: formString(formData, "productVariantId") || null,
          currentPrice: formString(formData, "currentPrice") || null,
        });
        await recordSubscriptionAdminAction(prisma, {
          shop,
          adminEmail: email,
          action: "UPDATE_RECURRING_LINE",
          contractId,
          targetId: formString(formData, "lineId"),
          status: "SUCCESS",
        });
        return {
          status: "success",
          message: "Recurring line was updated for future cycles.",
        } satisfies ActionResult;

      case "remove-recurring-line":
        await removeRecurringLine(
          admin,
          contractId ?? "",
          formString(formData, "lineId"),
        );
        await recordSubscriptionAdminAction(prisma, {
          shop,
          adminEmail: email,
          action: "REMOVE_RECURRING_LINE",
          contractId,
          targetId: formString(formData, "lineId"),
          status: "SUCCESS",
        });
        return {
          status: "success",
          message: "Recurring line was removed for future cycles.",
        } satisfies ActionResult;

      case "add-recurring-line":
        await addRecurringLine(admin, buildAddLineInput(formData));
        await recordSubscriptionAdminAction(prisma, {
          shop,
          adminEmail: email,
          action: "ADD_RECURRING_LINE",
          contractId,
          status: "SUCCESS",
        });
        return {
          status: "success",
          message: "Recurring line was added for future cycles.",
        } satisfies ActionResult;

      case "add-one-time-line":
        await addOneTimeLineToNextCycle(admin, buildAddLineInput(formData));
        await recordSubscriptionAdminAction(prisma, {
          shop,
          adminEmail: email,
          action: "ADD_ONE_TIME_LINE",
          contractId,
          status: "SUCCESS",
        });
        return {
          status: "success",
          message: "One-time line was added to the next cycle only.",
        } satisfies ActionResult;

      default:
        throw new Error("Unknown subscription admin action.");
    }
  } catch (error) {
    const message = formatShopifyError(error);
    await recordSubscriptionAdminAction(prisma, {
      shop,
      adminEmail: email,
      action: actionName,
      contractId,
      status: "ERROR",
      message,
    });

    return { status: "error", message } satisfies ActionResult;
  }
};

function formatDate(iso: string | null) {
  if (!iso) return "Not scheduled";

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
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

function statusClass(status: string) {
  switch (status) {
    case "ACTIVE":
      return `${styles.badge} ${styles.badgeSuccess}`;
    case "PAUSED":
      return `${styles.badge} ${styles.badgeWarning}`;
    case "CANCELLED":
    case "EXPIRED":
    case "FAILED":
      return `${styles.badge} ${styles.badgeCritical}`;
    default:
      return styles.badge;
  }
}

function priceInputValue(value: string | null) {
  return value?.replace(/[^0-9.]/g, "") ?? "";
}

function SearchResults({
  contracts,
  query,
  selectedContract,
}: {
  contracts: SubscriptionContract[];
  query: string;
  selectedContract: SubscriptionContract | null;
}) {
  if (contracts.length === 0) {
    return (
      <div className={styles.emptyState}>
        No subscriptions matched this search.
      </div>
    );
  }

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Contract</th>
            <th scope="col">Customer</th>
            <th scope="col">Status</th>
            <th scope="col">Cadence</th>
            <th scope="col">Next billing</th>
            <th scope="col">Lines</th>
          </tr>
        </thead>
        <tbody>
          {contracts.map((contract) => (
            <tr
              key={contract.id}
              className={
                selectedContract?.id === contract.id ? styles.selectedRow : ""
              }
            >
              <td>
                <Link
                  to={`?q=${encodeURIComponent(query)}&contractId=${encodeURIComponent(contract.id)}`}
                  className={styles.idLink}
                >
                  #{contract.numericId}
                </Link>
              </td>
              <td>
                <div className={styles.customerCell}>
                  <span>{contract.customer.displayName}</span>
                  {contract.customer.email ? (
                    <small>{contract.customer.email}</small>
                  ) : null}
                </div>
              </td>
              <td>
                <span className={statusClass(contract.status)}>
                  {contract.status}
                </span>
              </td>
              <td>{contract.cadence}</td>
              <td>{formatDate(contract.nextBillingDate)}</td>
              <td>{contract.lineSummary}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ContractSummary({ contract }: { contract: SubscriptionContract }) {
  return (
    <div className={styles.summaryGrid}>
      <div>
        <span className={styles.label}>Contract</span>
        <strong>#{contract.numericId}</strong>
      </div>
      <div>
        <span className={styles.label}>Status</span>
        <span className={statusClass(contract.status)}>{contract.status}</span>
      </div>
      <div>
        <span className={styles.label}>Customer</span>
        <strong>{contract.customer.displayName}</strong>
        {contract.customer.email ? <span>{contract.customer.email}</span> : null}
        {contract.customer.phone ? <span>{contract.customer.phone}</span> : null}
      </div>
      <div>
        <span className={styles.label}>Cadence</span>
        <strong>{contract.cadence}</strong>
      </div>
      <div>
        <span className={styles.label}>Next billing</span>
        <strong>{formatDate(contract.nextBillingDate)}</strong>
      </div>
      <div>
        <span className={styles.label}>Recent billing state</span>
        <strong>{contract.lastPaymentStatus ?? "No payment state"}</strong>
        {contract.lastBillingAttemptErrorType ? (
          <span>{contract.lastBillingAttemptErrorType}</span>
        ) : null}
      </div>
    </div>
  );
}

function ScheduleActions({ contractId }: { contractId: string }) {
  return (
    <div className={styles.actionGrid}>
      <Form method="post" className={styles.actionPanel}>
        <input type="hidden" name="intent" value="skip-next-cycle" />
        <input type="hidden" name="contractId" value={contractId} />
        <h3>Skip next cycle</h3>
        <p>
          Applies a merchant-initiated skip to the next unbilled billing cycle.
        </p>
        <button type="submit" className={styles.button}>
          Skip next cycle
        </button>
      </Form>

      <Form method="post" className={styles.actionPanel}>
        <input type="hidden" name="intent" value="change-next-date" />
        <input type="hidden" name="contractId" value={contractId} />
        <h3>Change next date</h3>
        <label className={styles.field}>
          <span>Next billing date</span>
          <input type="datetime-local" name="billingDate" required />
        </label>
        <button type="submit" className={styles.button}>
          Change date
        </button>
      </Form>
    </div>
  );
}

function LineEditor({ contract }: { contract: SubscriptionContract }) {
  return (
    <div className={styles.stack}>
      {contract.lines.map((line) => (
        <div key={line.id} className={styles.linePanel}>
          <div className={styles.lineHeader}>
            <div>
              <h3>{line.title}</h3>
              <p>
                {line.variantTitle ?? "Default variant"} ·{" "}
                {line.currentPrice ?? "No price"}
              </p>
            </div>
            <span className={styles.badge}>Qty {line.quantity}</span>
          </div>

          <Form method="post" className={styles.inlineGrid}>
            <input type="hidden" name="intent" value="update-recurring-line" />
            <input type="hidden" name="contractId" value={contract.id} />
            <input type="hidden" name="lineId" value={line.id} />
            <label className={styles.field}>
              <span>Quantity</span>
              <input
                type="number"
                name="quantity"
                min="1"
                defaultValue={line.quantity}
                required
              />
            </label>
            <label className={styles.field}>
              <span>Variant ID</span>
              <input
                type="text"
                name="productVariantId"
                defaultValue={line.variantId ?? ""}
                placeholder="gid://shopify/ProductVariant/..."
              />
            </label>
            <label className={styles.field}>
              <span>Price override</span>
              <input
                type="text"
                name="currentPrice"
                defaultValue={priceInputValue(line.currentPrice)}
                inputMode="decimal"
              />
            </label>
            <button type="submit" className={styles.button}>
              Save
            </button>
          </Form>

          <Form method="post">
            <input type="hidden" name="intent" value="remove-recurring-line" />
            <input type="hidden" name="contractId" value={contract.id} />
            <input type="hidden" name="lineId" value={line.id} />
            <button type="submit" className={styles.dangerButton}>
              Remove recurring line
            </button>
          </Form>
        </div>
      ))}

      <Form method="post" className={styles.actionPanel}>
        <input type="hidden" name="intent" value="add-recurring-line" />
        <input type="hidden" name="contractId" value={contract.id} />
        <h3>Add recurring product</h3>
        <div className={styles.inlineGrid}>
          <label className={styles.field}>
            <span>Variant ID</span>
            <input
              type="text"
              name="productVariantId"
              placeholder="gid://shopify/ProductVariant/..."
              required
            />
          </label>
          <label className={styles.field}>
            <span>Quantity</span>
            <input type="number" name="quantity" min="1" defaultValue="1" required />
          </label>
          <label className={styles.field}>
            <span>Price</span>
            <input type="text" name="currentPrice" inputMode="decimal" required />
          </label>
          <button type="submit" className={styles.button}>
            Add recurring
          </button>
        </div>
      </Form>
    </div>
  );
}

function OneTimeAddOnForm({ contractId }: { contractId: string }) {
  return (
    <Form method="post" className={styles.actionPanel}>
      <input type="hidden" name="intent" value="add-one-time-line" />
      <input type="hidden" name="contractId" value={contractId} />
      <h3>Add one-time product to next cycle</h3>
      <div className={styles.inlineGrid}>
        <label className={styles.field}>
          <span>Variant ID</span>
          <input
            type="text"
            name="productVariantId"
            placeholder="gid://shopify/ProductVariant/..."
            required
          />
        </label>
        <label className={styles.field}>
          <span>Quantity</span>
          <input type="number" name="quantity" min="1" defaultValue="1" required />
        </label>
        <label className={styles.field}>
          <span>Price</span>
          <input type="text" name="currentPrice" inputMode="decimal" required />
        </label>
        <button type="submit" className={styles.button}>
          Add to next cycle
        </button>
      </div>
    </Form>
  );
}

function BillingCycles({ contract }: { contract: SubscriptionContract }) {
  if (contract.upcomingBillingCycles.length === 0) {
    return <div className={styles.emptyState}>No upcoming cycles returned.</div>;
  }

  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">Cycle</th>
            <th scope="col">Expected billing</th>
            <th scope="col">Status</th>
            <th scope="col">Recent attempt</th>
          </tr>
        </thead>
        <tbody>
          {contract.upcomingBillingCycles.map((cycle) => (
            <tr key={cycle.cycleIndex}>
              <td>#{cycle.cycleIndex}</td>
              <td>{formatDateTime(cycle.billingAttemptExpectedDate)}</td>
              <td>
                <span className={styles.badge}>
                  {cycle.skipped ? "SKIPPED" : cycle.status}
                  {cycle.edited ? " · EDITED" : ""}
                </span>
              </td>
              <td>{cycle.billingAttempts[0]?.status ?? "No attempt"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SubscriptionAdminConsole() {
  const {
    query,
    contracts,
    selectedContract,
    subscriptionError,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const shopify = useAppBridge();
  const isSubmitting = navigation.state !== "idle";

  useEffect(() => {
    if (actionData?.message) {
      shopify.toast.show(actionData.message, {
        isError: actionData.status === "error",
      });
    }
  }, [actionData, shopify]);

  return (
    <s-page heading="Subscription admin">
      <s-section heading="Find subscriptions">
        <Form method="get" className={styles.searchForm}>
          <label className={styles.searchField}>
            <span>Search</span>
            <input
              type="search"
              name="q"
              defaultValue={query}
              placeholder="Name, email, phone, customer ID, or contract ID"
            />
          </label>
          <button type="submit" className={styles.button}>
            Search
          </button>
        </Form>

        {actionData ? (
          <div
            className={
              actionData.status === "success"
                ? styles.successBox
                : styles.errorBox
            }
          >
            {actionData.message}
          </div>
        ) : null}

        {subscriptionError ? (
          <div className={styles.errorBox}>{subscriptionError}</div>
        ) : (
          <SearchResults
            contracts={contracts}
            query={query}
            selectedContract={selectedContract}
          />
        )}
      </s-section>

      <s-section heading="Contract detail">
        {selectedContract ? (
          <div className={styles.stack}>
            <ContractSummary contract={selectedContract} />
            <ScheduleActions contractId={selectedContract.id} />
            <LineEditor contract={selectedContract} />
            <OneTimeAddOnForm contractId={selectedContract.id} />
            <BillingCycles contract={selectedContract} />
          </div>
        ) : (
          <div className={styles.emptyState}>
            Select a subscription contract to manage it.
          </div>
        )}
      </s-section>

      {isSubmitting ? (
        <s-section slot="aside" heading="Status">
          <div className={styles.muted}>Submitting Shopify admin action...</div>
        </s-section>
      ) : null}
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

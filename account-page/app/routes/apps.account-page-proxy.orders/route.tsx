import { useEffect, useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { authenticateCustomerAdminAppProxyRequest } from "../../app-proxy.server";
import { TabError } from "../apps.account-page-proxy/tab-error";
import styles from "./styles.module.css";

declare global {
  interface Window {
    Shopify?: {
      routes?: {
        root?: string;
      };
    };
  }
}

type PaymentStatus = "Paid" | "Pending" | "Refunded";
type FulfillmentStatus = "Fulfilled" | "Unfulfilled" | "In transit";

type ReorderLine = {
  variantId: number | null;
  sellingPlanId: number | null;
  quantity: number;
  title: string;
  available: boolean;
  properties: Record<string, string>;
};

type AddableReorderLine = ReorderLine & { variantId: number };

type CartItem = {
  id: number;
  quantity: number;
  selling_plan?: number;
  properties?: Record<string, string>;
};

type CustomerOrderLineItemNode = {
  quantity: number;
  currentQuantity?: number;
  title: string;
  customAttributes?: Array<{ key: string; value?: string | null }> | null;
  sellingPlan?: { sellingPlanId?: string | null } | null;
  variant?: { id: string; availableForSale: boolean } | null;
};

type CustomerOrderNode = {
  id: string;
  name: string;
  processedAt: string;
  displayFinancialStatus?: string | null;
  displayFulfillmentStatus?: string | null;
  currentTotalPriceSet: {
    shopMoney: {
      amount: string;
      currencyCode: string;
    };
  };
  subtotalLineItemsQuantity: number;
  lineItems?: {
    nodes?: CustomerOrderLineItemNode[] | null;
  } | null;
};

type CustomerOrdersResponse = {
  orders?: {
    nodes?: CustomerOrderNode[] | null;
  } | null;
};

type Order = {
  id: string;
  number: string;
  placedAt: string;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  total: string;
  itemCount: number;
  lineItems: ReorderLine[];
};

const CUSTOMER_ORDERS_QUERY = `#graphql
  query CustomerOrders($query: String!, $first: Int!) {
    orders(first: $first, query: $query, sortKey: PROCESSED_AT, reverse: true) {
      nodes {
        id
        name
        processedAt
        displayFinancialStatus
        displayFulfillmentStatus
        currentTotalPriceSet { shopMoney { amount currencyCode } }
        subtotalLineItemsQuantity
        lineItems(first: 50) {
          nodes {
            quantity
            currentQuantity
            title
            customAttributes {
              key
              value
            }
            sellingPlan {
              sellingPlanId
            }
            variant {
              id
              availableForSale
            }
          }
        }
      }
    }
  }
` as const;

const VARIANT_GID_PREFIX = "gid://shopify/ProductVariant/";
const SELLING_PLAN_GID_PREFIX = "gid://shopify/SellingPlan/";

function numericIdFromGid(id: string | null | undefined, prefix: string) {
  const numericId = id?.startsWith(prefix) ? id.slice(prefix.length) : null;
  if (!numericId || !/^\d+$/.test(numericId)) return null;

  return Number(numericId);
}

function mapCustomAttributes(
  attributes: Array<{ key: string; value?: string | null }> | null | undefined,
) {
  const properties: Record<string, string> = {};

  for (const attribute of attributes ?? []) {
    if (attribute.key && attribute.value != null) {
      properties[attribute.key] = attribute.value;
    }
  }

  return properties;
}

function mapLineItem(node: CustomerOrderLineItemNode): ReorderLine {
  const variantId = numericIdFromGid(node.variant?.id, VARIANT_GID_PREFIX);
  const available = !!node.variant?.availableForSale;

  return {
    variantId,
    sellingPlanId: numericIdFromGid(
      node.sellingPlan?.sellingPlanId,
      SELLING_PLAN_GID_PREFIX,
    ),
    quantity: Math.max(0, node.currentQuantity ?? node.quantity),
    title: node.title,
    available,
    properties: mapCustomAttributes(node.customAttributes),
  };
}

function mapPaymentStatus(raw: string | null | undefined): PaymentStatus {
  switch (raw) {
    case "PAID":
    case "PARTIALLY_PAID":
      return "Paid";
    case "REFUNDED":
    case "PARTIALLY_REFUNDED":
    case "VOIDED":
    case "EXPIRED":
      return "Refunded";
    default:
      return "Pending";
  }
}

function mapFulfillmentStatus(
  raw: string | null | undefined,
): FulfillmentStatus {
  switch (raw) {
    case "FULFILLED":
      return "Fulfilled";
    case "IN_PROGRESS":
    case "PARTIALLY_FULFILLED":
    case "ON_HOLD":
    case "SCHEDULED":
    case "PENDING_FULFILLMENT":
      return "In transit";
    default:
      return "Unfulfilled";
  }
}

function formatMoney(amount: string, currencyCode: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode,
  }).format(parseFloat(amount));
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { admin, customerId } =
      await authenticateCustomerAdminAppProxyRequest(request);

    const res = await admin.graphql(CUSTOMER_ORDERS_QUERY, {
      variables: { query: `customer_id:${customerId}`, first: 20 },
    });

    const { data } = (await res.json()) as { data?: CustomerOrdersResponse };

    const orders: Order[] = (data?.orders?.nodes ?? []).map((node) => ({
      id: node.id,
      number: node.name,
      placedAt: node.processedAt,
      paymentStatus: mapPaymentStatus(node.displayFinancialStatus),
      fulfillmentStatus: mapFulfillmentStatus(node.displayFulfillmentStatus),
      total: formatMoney(
        node.currentTotalPriceSet.shopMoney.amount,
        node.currentTotalPriceSet.shopMoney.currencyCode,
      ),
      itemCount: node.subtotalLineItemsQuantity,
      lineItems: (node.lineItems?.nodes ?? []).map(mapLineItem),
    }));

    return { orders };
  } catch (err) {
    if (err instanceof Response) throw err;
    console.error("Orders loader error:", err);
    throw new Response("unexpected-error", { status: 422 });
  }
};

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

function paymentBadgeClass(status: Order["paymentStatus"]) {
  switch (status) {
    case "Paid":
      return `${styles.badge} ${styles.badgePaid}`;
    case "Pending":
      return `${styles.badge} ${styles.badgePending}`;
    case "Refunded":
      return `${styles.badge} ${styles.badgeRefunded}`;
  }
}

function fulfillmentBadgeClass(status: Order["fulfillmentStatus"]) {
  switch (status) {
    case "Fulfilled":
      return `${styles.badge} ${styles.badgeFulfilled}`;
    case "Unfulfilled":
      return `${styles.badge} ${styles.badgeUnfulfilled}`;
    case "In transit":
      return `${styles.badge} ${styles.badgeInTransit}`;
  }
}

export function ErrorBoundary() {
  return <TabError resource="orders" />;
}

type ReorderResult =
  | { kind: "ok" }
  | { kind: "partial" }
  | { kind: "error"; message: string };

function getCartAddUrl() {
  const routeRoot = window.Shopify?.routes?.root ?? "/";
  const normalizedRoot = routeRoot.endsWith("/") ? routeRoot : `${routeRoot}/`;

  return `${normalizedRoot}cart/add.js`;
}

function getSkipReason(line: ReorderLine) {
  if (!line.variantId)
    return `${line.title}: no longer has an orderable variant`;
  if (!line.available) return `${line.title}: not available for sale`;
  if (line.quantity < 1) return `${line.title}: no quantity left to reorder`;

  return null;
}

function isAddableLine(line: ReorderLine): line is AddableReorderLine {
  return getSkipReason(line) === null;
}

function buildCartItem(line: AddableReorderLine): CartItem {
  const item: CartItem = {
    id: line.variantId,
    quantity: line.quantity,
  };

  if (line.sellingPlanId) {
    item.selling_plan = line.sellingPlanId;
  }

  if (Object.keys(line.properties).length > 0) {
    item.properties = line.properties;
  }

  return item;
}

async function reorder(lines: ReorderLine[]): Promise<ReorderResult> {
  const available = lines.filter(isAddableLine);
  const skippedCount = lines.length - available.length;

  if (available.length === 0) {
    return {
      kind: "error",
      message: "No items from this order could be added to your cart.",
    };
  }

  try {
    const res = await fetch(getCartAddUrl(), {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({
        items: available.map(buildCartItem),
      }),
    });

    if (!res.ok) {
      return {
        kind: "error",
        message: "We couldn't add any items to your cart. Please try again.",
      };
    }

    return skippedCount > 0 ? { kind: "partial" } : { kind: "ok" };
  } catch {
    return {
      kind: "error",
      message: "We couldn't add any items to your cart. Please try again.",
    };
  }
}

type ReorderState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "partial" }
  | { status: "error"; message: string };

function ReorderButton({ lines }: { lines: ReorderLine[] }) {
  const [state, setState] = useState<ReorderState>({ status: "idle" });

  useEffect(() => {
    const resetLoadingState = (event: PageTransitionEvent) => {
      if (event.persisted) {
        setState({ status: "idle" });
      }
    };

    window.addEventListener("pageshow", resetLoadingState);
    return () => window.removeEventListener("pageshow", resetLoadingState);
  }, []);

  async function handleClick() {
    setState({ status: "loading" });
    const result = await reorder(lines);
    if (result.kind === "ok") {
      setState({ status: "idle" });
      window.location.assign("/cart");
      return;
    }
    if (result.kind === "partial") {
      setState({ status: "partial" });
      return;
    }
    setState({ status: "error", message: result.message });
  }

  const isLoading = state.status === "loading";

  return (
    <>
      <button
        type="button"
        className={styles.reorderButton}
        onClick={handleClick}
        disabled={isLoading}
        aria-busy={isLoading}
      >
        {isLoading ? (
          <span className={styles.spinner} aria-hidden="true" />
        ) : null}
        {isLoading ? "Adding…" : "Reorder"}
      </button>
      {state.status === "partial" ? (
        <p className={`${styles.notice} ${styles.skippedNotice}`} role="status">
          Some items were unable to be added to your cart.{" "}
          <a href="/cart" className={styles.noticeLink}>
            View cart
          </a>
        </p>
      ) : null}
      {state.status === "error" ? (
        <p className={`${styles.notice} ${styles.errorNotice}`} role="alert">
          {state.message}
        </p>
      ) : null}
    </>
  );
}

export default function OrdersTab() {
  const { orders } = useLoaderData<typeof loader>();

  return (
    <section aria-labelledby="orders-heading">
      <h2 id="orders-heading" className={styles.heading}>
        Order history
      </h2>

      {orders.length === 0 ? (
        <div role="status" className={styles.empty}>
          You haven&apos;t placed any orders yet.
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Order</th>
                <th scope="col">Date</th>
                <th scope="col">Payment</th>
                <th scope="col">Fulfillment</th>
                <th scope="col">Items</th>
                <th scope="col">Total</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td data-label="Order" className={styles.orderNumber}>
                    {order.number}
                  </td>
                  <td data-label="Date">{formatDate(order.placedAt)}</td>
                  <td data-label="Payment">
                    <span className={paymentBadgeClass(order.paymentStatus)}>
                      {order.paymentStatus}
                    </span>
                  </td>
                  <td data-label="Fulfillment">
                    <span
                      className={fulfillmentBadgeClass(order.fulfillmentStatus)}
                    >
                      {order.fulfillmentStatus}
                    </span>
                  </td>
                  <td data-label="Items">{order.itemCount}</td>
                  <td data-label="Total">{order.total}</td>
                  <td data-label="Actions" className={styles.actionCell}>
                    <ReorderButton lines={order.lineItems} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

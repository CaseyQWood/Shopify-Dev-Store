import { useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { authenticate } from "../../shopify.server";
import { TabError } from "../apps.account-page-proxy/tab-error";
import styles from "./styles.module.css";

type PaymentStatus = "Paid" | "Pending" | "Refunded";
type FulfillmentStatus = "Fulfilled" | "Unfulfilled" | "In transit";

type ReorderLine = {
  variantId: string;
  quantity: number;
  title: string;
  available: boolean;
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
            title
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

function mapLineItem(node: {
  quantity: number;
  title: string;
  variant?: { id: string; availableForSale: boolean } | null;
}): ReorderLine {
  const available = !!node.variant?.availableForSale;
  return {
    variantId: node.variant ? node.variant.id.replace(VARIANT_GID_PREFIX, "") : "",
    quantity: node.quantity,
    title: node.title,
    available,
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

function mapFulfillmentStatus(raw: string | null | undefined): FulfillmentStatus {
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
    let session, admin;
    try {
      ({ session, admin } = await authenticate.public.appProxy(request));
    } catch (authErr) {
      console.log(authErr, "---------")
      console.error("[orders loader] auth threw:", authErr);
      if (authErr instanceof Response) {
        console.error("[orders loader] auth response status:", authErr.status, "body:", await authErr.clone().text());
      }
      throw authErr;
    }
    if (!session || !admin) throw new Response("not-signed-in", { status: 422 });

    const customerId = new URL(request.url).searchParams.get("logged_in_customer_id");
    if (!customerId) throw new Response("not-signed-in", { status: 422 });

    const res = await admin.graphql(CUSTOMER_ORDERS_QUERY, {
      variables: { query: `customer_id:${customerId}`, first: 20 },
    });

    const { data } = await res.json();

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
  | { kind: "partial"; skipped: string[] }
  | { kind: "empty" }
  | { kind: "error"; message: string };

async function reorder(lines: ReorderLine[]): Promise<ReorderResult> {
  const available = lines.filter((l) => l.available && l.variantId);
  const skipped = lines.filter((l) => !l.available || !l.variantId).map((l) => l.title);

  if (available.length === 0) return { kind: "empty" };

  try {
    const res = await fetch("/cart/add.js", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: JSON.stringify({
        items: available.map((l) => ({ id: l.variantId, quantity: l.quantity })),
      }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const message = typeof body?.description === "string"
        ? body.description
        : "We couldn't add these items to your cart. Please try again.";
      return { kind: "error", message };
    }

    return skipped.length > 0 ? { kind: "partial", skipped } : { kind: "ok" };
  } catch {
    return { kind: "error", message: "Network error. Please try again." };
  }
}

type ReorderState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "partial"; skipped: string[] }
  | { status: "empty" }
  | { status: "error"; message: string };

function ReorderButton({ lines }: { lines: ReorderLine[] }) {

  const [state, setState] = useState<ReorderState>({ status: "idle" });

  async function handleClick() {
    console.log("-----------------here-------------")
    setState({ status: "loading" });
    const result = await reorder(lines);
    if (result.kind === "ok") {
      window.location.assign("/cart");
      return;
    }
    if (result.kind === "partial") {
      setState({ status: "partial", skipped: result.skipped });
      return;
    }
    if (result.kind === "empty") {
      setState({ status: "empty" });
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
        {isLoading ? <span className={styles.spinner} aria-hidden="true" /> : null}
        {isLoading ? "Adding…" : "Reorder"}
      </button>
      {state.status === "partial" ? (
        <p className={`${styles.notice} ${styles.skippedNotice}`} role="status">
          Couldn&apos;t add: {state.skipped.join(", ")}.{" "}
          <a href="/cart" className={styles.noticeLink}>View cart</a>
        </p>
      ) : null}
      {state.status === "empty" ? (
        <p className={`${styles.notice} ${styles.errorNotice}`} role="status">
          No items from this order are available.
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
        <div role="status" className={styles.empty}>You haven&apos;t placed any orders yet.</div>
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

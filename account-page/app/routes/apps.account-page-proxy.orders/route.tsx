import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { authenticateCustomerAdminAppProxyRequest } from "../../app-proxy.server";
import { TabError } from "../apps.account-page-proxy/tab-error";
import { getCustomerOrders, type Order } from "./orders.server";
import { ReorderButton } from "./reorder-button";
import styles from "./styles.module.css";

const DISPLAY_LOCALE = "en-US";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { admin, customerId } =
      await authenticateCustomerAdminAppProxyRequest(request);
    const orders = await getCustomerOrders(admin, customerId);

    return { orders };
  } catch (err) {
    if (err instanceof Response) throw err;
    console.error("Orders loader error:", err);
    throw new Response("unexpected-error", { status: 422 });
  }
};

function formatDate(iso: string) {
  return new Intl.DateTimeFormat(DISPLAY_LOCALE, {
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

function OrderRow({ order }: { order: Order }) {
  return (
    <tr>
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
        <span className={fulfillmentBadgeClass(order.fulfillmentStatus)}>
          {order.fulfillmentStatus}
        </span>
      </td>
      <td data-label="Items">{order.itemCount}</td>
      <td data-label="Total">{order.total}</td>
      <td data-label="Actions" className={styles.actionCell}>
        <ReorderButton lineItems={order.lineItems} />
      </td>
    </tr>
  );
}

function OrdersTable({ orders }: { orders: Order[] }) {
  return (
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
            <OrderRow key={order.id} order={order} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ErrorBoundary() {
  return <TabError resource="orders" />;
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
        <OrdersTable orders={orders} />
      )}
    </section>
  );
}

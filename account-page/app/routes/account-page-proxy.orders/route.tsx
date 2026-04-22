import { useLoaderData } from "react-router";

import type { MockOrder } from "../account-page-proxy/mock";
import { getMockOrders } from "../account-page-proxy/mock";
import styles from "./styles.module.css";

export const loader = async () => {
  return { orders: getMockOrders() };
};

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

function paymentBadgeClass(status: MockOrder["paymentStatus"]) {
  switch (status) {
    case "Paid":
      return `${styles.badge} ${styles.badgePaid}`;
    case "Pending":
      return `${styles.badge} ${styles.badgePending}`;
    case "Refunded":
      return `${styles.badge} ${styles.badgeRefunded}`;
  }
}

function fulfillmentBadgeClass(status: MockOrder["fulfillmentStatus"]) {
  switch (status) {
    case "Fulfilled":
      return `${styles.badge} ${styles.badgeFulfilled}`;
    case "Unfulfilled":
      return `${styles.badge} ${styles.badgeUnfulfilled}`;
    case "In transit":
      return `${styles.badge} ${styles.badgeInTransit}`;
  }
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

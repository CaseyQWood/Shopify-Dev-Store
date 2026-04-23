import { useLoaderData } from "react-router";

import type { MockSubscription } from "../account-page-proxy/mock";
import { getMockSubscriptions } from "../account-page-proxy/mock";
import styles from "./styles.module.css";

export const loader = async () => {
  return { subscriptions: getMockSubscriptions() };
};

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

function statusBadgeClass(status: MockSubscription["status"]) {
  switch (status) {
    case "Active":
      return `${styles.badge} ${styles.badgeActive}`;
    case "Paused":
      return `${styles.badge} ${styles.badgePaused}`;
    case "Cancelled":
      return `${styles.badge} ${styles.badgeCancelled}`;
  }
}

export default function SubscriptionsTab() {
  const { subscriptions } = useLoaderData<typeof loader>();

  return (
    <section aria-labelledby="subscriptions-heading">
      <h2 id="subscriptions-heading" className={styles.heading}>
        Subscriptions
      </h2>

      {subscriptions.length === 0 ? (
        <div role="status" className={styles.empty}>You don&apos;t have any subscriptions.</div>
      ) : (
        <ul className={styles.list}>
          {subscriptions.map((sub) => (
            <li key={sub.id} className={styles.card}>
              <div>
                <div className={styles.cardHeader}>
                  <h3 className={styles.cardTitle}>{sub.name}</h3>
                  <span className={statusBadgeClass(sub.status)}>
                    {sub.status}
                  </span>
                </div>
                <p className={styles.cardMeta}>{sub.interval}</p>
                <p className={styles.cardMeta}>
                  Next charge: {formatDate(sub.nextChargeAt)}
                </p>
              </div>
              <div className={styles.cardPrice}>{sub.price}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

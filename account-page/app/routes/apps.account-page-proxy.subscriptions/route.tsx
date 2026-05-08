import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";

import { authenticateCustomerAdminAppProxyRequest } from "../../app-proxy.server";
import { getCustomerSubscriptionContracts } from "../../subscriptions/subscription-contracts.server";
import { TabError } from "../apps.account-page-proxy/tab-error";
import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { admin, customerId } =
      await authenticateCustomerAdminAppProxyRequest(request);
    const subscriptions = await getCustomerSubscriptionContracts(
      admin,
      customerId,
    );

    return { subscriptions };
  } catch (err) {
    if (err instanceof Response) throw err;
    console.error("Subscriptions loader error:", err);
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

function statusBadgeClass(status: string) {
  switch (status) {
    case "ACTIVE":
      return `${styles.badge} ${styles.badgeActive}`;
    case "PAUSED":
      return `${styles.badge} ${styles.badgePaused}`;
    case "CANCELLED":
    case "EXPIRED":
    case "FAILED":
      return `${styles.badge} ${styles.badgeCancelled}`;
    default:
      return styles.badge;
  }
}

export function ErrorBoundary() {
  return <TabError resource="subscriptions" />;
}

export default function SubscriptionsTab() {
  const { subscriptions } = useLoaderData<typeof loader>();

  return (
    <section aria-labelledby="subscriptions-heading">
      <h2 id="subscriptions-heading" className={styles.heading}>
        Subscriptions
      </h2>

      {subscriptions.length === 0 ? (
        <div role="status" className={styles.empty}>
          You don&apos;t have any subscriptions.
        </div>
      ) : (
        <ul className={styles.list}>
          {subscriptions.map((sub) => (
            <li key={sub.id} className={styles.card}>
              <div>
                <div className={styles.cardHeader}>
                  <h3 className={styles.cardTitle}>{sub.lineSummary}</h3>
                  <span className={statusBadgeClass(sub.status)}>
                    {sub.status}
                  </span>
                </div>
                <p className={styles.cardMeta}>{sub.cadence}</p>
                <p className={styles.cardMeta}>
                  Next charge:{" "}
                  {sub.nextBillingDate
                    ? formatDate(sub.nextBillingDate)
                    : "Not scheduled"}
                </p>
              </div>
              <div className={styles.cardPrice}>{sub.total ?? ""}</div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

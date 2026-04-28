import type { LoaderFunctionArgs } from "react-router";
import {
  isRouteErrorResponse,
  Outlet,
  useLoaderData,
  useRouteError,
} from "react-router";

import { authenticate } from "../../shopify.server";
import { getMockUser } from "./mock";
import styles from "./styles.module.css";

type TabId = "orders" | "subscriptions" | "account-details";

function resolveActiveTab(pathname: string): TabId | null {
  if (pathname.endsWith("/orders")) return "orders";
  if (pathname.endsWith("/subscriptions")) return "subscriptions";
  if (pathname.endsWith("/account-details")) return "account-details";
  return null;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    await authenticate.public.appProxy(request);
  } catch (err) {
    console.error("[layout loader] auth threw:", err);
    if (err instanceof Response) {
      console.error(
        "[layout loader] response status:",
        err.status,
        "body:",
        await err.clone().text(),
      );
    }
    throw err;
  }

  const url = new URL(request.url);
  const loggedInCustomerId = url.searchParams.get("logged_in_customer_id");
  const shop = url.searchParams.get("shop");
  const pathPrefix = url.searchParams.get("path_prefix") ?? "";
  const activeTab = resolveActiveTab(url.pathname);

  const user = loggedInCustomerId ? getMockUser() : null;

  return {
    shop,
    loggedInCustomerId,
    user,
    pathPrefix,
    activeTab,
  };
};

export default function AccountPageLayout() {
  const { user, pathPrefix, activeTab } = useLoaderData<typeof loader>();

  const tabClass = (tab: TabId) =>
    activeTab === tab
      ? `${styles.tabLink} ${styles.tabLinkActive}`
      : styles.tabLink;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>My Account</h1>
        {user ? (
          <p className={styles.subtitle}>
            Welcome back, {user.firstName}.
          </p>
        ) : (
          <p className={styles.subtitle}>
            Manage your orders, subscriptions, and account details.
          </p>
        )}
      </header>

      {user ? (
        <div className={styles.layout}>
          <main className={styles.main}>
            <nav className={styles.tabNav} aria-label="Account sections">
              <a
                href={`${pathPrefix}/orders`}
                className={tabClass("orders")}
                aria-current={activeTab === "orders" ? "page" : undefined}
              >
                Orders
              </a>
              <a
                href={`${pathPrefix}/subscriptions`}
                className={tabClass("subscriptions")}
                aria-current={
                  activeTab === "subscriptions" ? "page" : undefined
                }
              >
                Subscriptions
              </a>
              <a
                href={`${pathPrefix}/account-details`}
                className={tabClass("account-details")}
                aria-current={
                  activeTab === "account-details" ? "page" : undefined
                }
              >
                Account Details
              </a>
            </nav>
            <div className={styles.tabPanel}>
              <Outlet />
            </div>
          </main>

          <aside className={styles.sidebar} aria-label="Account summary">
            <div className={styles.summary}>
              <p className={styles.summaryHeader}>Account</p>
              <p className={styles.summaryName}>
                {user.firstName} {user.lastName}
              </p>
              <p className={styles.summaryField}>{user.email}</p>
              <p className={styles.summaryField}>{user.phone}</p>
              <hr className={styles.summaryDivider} />
              <p className={styles.summaryAddressLabel}>Default address</p>
              <address className={styles.summaryAddress}>
                {user.defaultAddress.name}
                <br />
                {user.defaultAddress.line1}
                {user.defaultAddress.line2 ? (
                  <>
                    <br />
                    {user.defaultAddress.line2}
                  </>
                ) : null}
                <br />
                {user.defaultAddress.city}, {user.defaultAddress.region}{" "}
                {user.defaultAddress.postalCode}
                <br />
                {user.defaultAddress.country}
              </address>
            </div>
          </aside>
        </div>
      ) : (
        <div className={styles.loggedOut}>
          Please log in to view your account.
        </div>
      )}
    </div>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const message =
    isRouteErrorResponse(error) && error.status === 401
      ? "Please log in to view your account."
      : "Something went wrong. Please refresh the page.";
  return (
    <div className={styles.page}>
      <div role="alert" className={styles.layoutError}>
        {message}
      </div>
    </div>
  );
}

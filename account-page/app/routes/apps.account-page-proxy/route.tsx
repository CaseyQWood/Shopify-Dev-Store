import type { LoaderFunctionArgs } from "react-router";
import {
  isRouteErrorResponse,
  NavLink,
  Outlet,
  useLoaderData,
  useRouteError,
} from "react-router";

import { authenticate } from "../../shopify.server";
import { getMockUser } from "./mock";
import styles from "./styles.module.css";

function normalizePathPrefix(pathPrefix: string | null) {
  const fallback = "/apps/account-page-proxy";
  const value = pathPrefix || fallback;
  return value === "/" ? "" : value.replace(/\/$/, "");
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
  const pathPrefix = normalizePathPrefix(url.searchParams.get("path_prefix"));

  const user = loggedInCustomerId ? getMockUser() : null;

  return {
    shop,
    loggedInCustomerId,
    user,
    pathPrefix,
  };
};

export default function AccountPageLayout() {
  const { user, pathPrefix } = useLoaderData<typeof loader>();

  const tabClass = ({ isActive }: { isActive: boolean }) =>
    isActive ? `${styles.tabLink} ${styles.tabLinkActive}` : styles.tabLink;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>My Account</h1>
        {user ? (
          <p className={styles.subtitle}>Welcome back, {user.firstName}.</p>
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
              <NavLink to={`${pathPrefix}/orders`} className={tabClass}>
                Orders
              </NavLink>
              <NavLink to={`${pathPrefix}/subscriptions`} className={tabClass}>
                Subscriptions
              </NavLink>
              <NavLink
                to={`${pathPrefix}/account-details`}
                className={tabClass}
              >
                Account Details
              </NavLink>
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

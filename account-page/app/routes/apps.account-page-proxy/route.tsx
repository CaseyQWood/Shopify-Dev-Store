import type { LoaderFunctionArgs } from "react-router";
import {
  isRouteErrorResponse,
  NavLink,
  Outlet,
  useLoaderData,
  useRouteError,
} from "react-router";

import { authenticateAppProxyRequest } from "../../app-proxy.server";
import { fetchCustomerProfile } from "./customer.server";
import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { customerId, pathPrefix, shop, admin } =
    await authenticateAppProxyRequest(request);

  let user = null;
  if (customerId && admin) {
    try {
      const result = await fetchCustomerProfile(admin, customerId);
      user = result.user;
    } catch (err) {
      console.error("[account-proxy] failed to load customer profile", err);
    }
  }

  return {
    shop,
    loggedInCustomerId: customerId,
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
              {user.email ? (
                <p className={styles.summaryField}>{user.email}</p>
              ) : null}
              {user.phone ? (
                <p className={styles.summaryField}>{user.phone}</p>
              ) : null}
              {user.defaultAddress ? (
                <>
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
                </>
              ) : null}
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

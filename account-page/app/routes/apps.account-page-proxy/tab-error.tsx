import { isRouteErrorResponse, useRouteError } from "react-router";

import styles from "./tab-error.module.css";

export function TabError({ resource }: { resource: string }) {
  const error = useRouteError();
  const reason = isRouteErrorResponse(error) ? error.data : null;

  const message =
    reason === "not-signed-in"
      ? `Please log in to view your ${resource}.`
      : `Something went wrong loading your ${resource}. Please try again.`;
  return (
    <div role="alert" className={styles.tabError}>
      {message}
    </div>
  );
}

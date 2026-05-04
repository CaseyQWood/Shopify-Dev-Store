import { useEffect, useState } from "react";

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

export type ReorderLine = {
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

type ReorderResult =
  | { kind: "ok" }
  | { kind: "partial" }
  | { kind: "error"; message: string };

type ReorderState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "partial" }
  | { status: "error"; message: string };

const ADD_TO_CART_ERROR_MESSAGE =
  "We couldn't add any items to your cart. Please try again.";
const EMPTY_REORDER_ERROR_MESSAGE =
  "No items from this order could be added to your cart.";
const CART_ERROR_BODY_PREVIEW_LENGTH = 500;

function getShopifyUrl(path: string) {
  const routeRoot = window.Shopify?.routes?.root ?? "/";
  const normalizedRoot = routeRoot.endsWith("/") ? routeRoot : `${routeRoot}/`;
  const normalizedPath = path.replace(/^\/+/, "");

  return `${normalizedRoot}${normalizedPath}`;
}

function getCartAddUrl() {
  return getShopifyUrl("cart/add.js");
}

function getCartUrl() {
  return getShopifyUrl("cart");
}

function getSkipReason(line: ReorderLine) {
  if (!line.variantId) {
    return `${line.title}: no longer has an orderable variant`;
  }
  if (!line.available) {
    return `${line.title}: not available for sale`;
  }
  if (line.quantity < 1) {
    return `${line.title}: no quantity left to reorder`;
  }

  return null;
}

function isAddableLine(line: ReorderLine): line is AddableReorderLine {
  return getSkipReason(line) === null;
}

function buildCartItem(line: AddableReorderLine): CartItem {
  return {
    id: line.variantId,
    quantity: line.quantity,
    ...(line.sellingPlanId ? { selling_plan: line.sellingPlanId } : {}),
    ...(Object.keys(line.properties).length > 0
      ? { properties: { ...line.properties } }
      : {}),
  };
}

async function readCartErrorBody(response: Response) {
  try {
    return (await response.text()).slice(0, CART_ERROR_BODY_PREVIEW_LENGTH);
  } catch (error) {
    console.error("Unable to read cart add error response:", error);
    return null;
  }
}

async function logCartResponseError(response: Response) {
  console.error("Cart add request failed:", {
    status: response.status,
    statusText: response.statusText,
    body: await readCartErrorBody(response),
  });
}

async function reorder(lineItems: ReorderLine[]): Promise<ReorderResult> {
  const available = lineItems.filter(isAddableLine);
  const skippedCount = lineItems.length - available.length;

  if (available.length === 0) {
    return {
      kind: "error",
      message: EMPTY_REORDER_ERROR_MESSAGE,
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
      await logCartResponseError(res);

      return {
        kind: "error",
        message: ADD_TO_CART_ERROR_MESSAGE,
      };
    }

    return skippedCount > 0 ? { kind: "partial" } : { kind: "ok" };
  } catch (error) {
    console.error("Cart add request error:", error);

    return {
      kind: "error",
      message: ADD_TO_CART_ERROR_MESSAGE,
    };
  }
}

export function ReorderButton({
  lineItems,
}: {
  lineItems: ReorderLine[];
}) {
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
    const result = await reorder(lineItems);
    if (result.kind === "ok") {
      setState({ status: "idle" });
      window.location.assign(getCartUrl());
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
          <a href={getCartUrl()} className={styles.noticeLink}>
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

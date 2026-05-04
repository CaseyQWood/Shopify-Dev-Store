import type { ReorderLine } from "./reorder-button";

type PaymentStatus = "Paid" | "Pending" | "Refunded";
type FulfillmentStatus = "Fulfilled" | "Unfulfilled" | "In transit";

type CustomerOrderLineItemNode = {
  quantity: number;
  currentQuantity?: number;
  title: string;
  customAttributes?: Array<{ key: string; value?: string | null }> | null;
  sellingPlan?: { sellingPlanId?: string | null } | null;
  variant?: { id: string; availableForSale: boolean } | null;
};

type CustomerOrderNode = {
  id: string;
  name: string;
  processedAt: string;
  displayFinancialStatus?: string | null;
  displayFulfillmentStatus?: string | null;
  currentTotalPriceSet: {
    shopMoney: {
      amount: string;
      currencyCode: string;
    };
  };
  subtotalLineItemsQuantity: number;
  lineItems?: {
    nodes?: CustomerOrderLineItemNode[] | null;
  } | null;
};

type CustomerOrdersQueryVariables = {
  query: string;
  first: number;
  lineItemsFirst: number;
};

type AdminGraphqlClient = {
  graphql: (
    query: string,
    options: { variables: CustomerOrdersQueryVariables },
  ) => Promise<Response>;
};

export type Order = {
  id: string;
  number: string;
  placedAt: string;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  total: string;
  itemCount: number;
  lineItems: ReorderLine[];
};

const ORDERS_PAGE_SIZE = 20;
const ORDER_LINE_ITEMS_PAGE_SIZE = 50;
const MONEY_DISPLAY_LOCALE = "en-US";
const VARIANT_GID_PREFIX = "gid://shopify/ProductVariant/";
const SELLING_PLAN_GID_PREFIX = "gid://shopify/SellingPlan/";
const NUMERIC_ID_PATTERN = /^\d+$/;
const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

const CUSTOMER_ORDERS_QUERY = `#graphql
  query CustomerOrders($query: String!, $first: Int!, $lineItemsFirst: Int!) {
    orders(first: $first, query: $query, sortKey: PROCESSED_AT, reverse: true) {
      nodes {
        id
        name
        processedAt
        displayFinancialStatus
        displayFulfillmentStatus
        currentTotalPriceSet { shopMoney { amount currencyCode } }
        subtotalLineItemsQuantity
        lineItems(first: $lineItemsFirst) {
          nodes {
            quantity
            currentQuantity
            title
            customAttributes {
              key
              value
            }
            sellingPlan {
              sellingPlanId
            }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNullableString(value: unknown): value is string | null | undefined {
  return value === null || value === undefined || typeof value === "string";
}

function isValidDateString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isCustomAttribute(
  value: unknown,
): value is { key: string; value?: string | null } {
  return (
    isRecord(value) &&
    typeof value.key === "string" &&
    isNullableString(value.value)
  );
}

function isCustomAttributes(
  value: unknown,
): value is Array<{ key: string; value?: string | null }> | null | undefined {
  return (
    value === null ||
    value === undefined ||
    (Array.isArray(value) && value.every(isCustomAttribute))
  );
}

function isSellingPlan(
  value: unknown,
): value is CustomerOrderLineItemNode["sellingPlan"] {
  return (
    value === null ||
    value === undefined ||
    (isRecord(value) && isNullableString(value.sellingPlanId))
  );
}

function isVariant(value: unknown): value is CustomerOrderLineItemNode["variant"] {
  return (
    value === null ||
    value === undefined ||
    (isRecord(value) &&
      typeof value.id === "string" &&
      typeof value.availableForSale === "boolean")
  );
}

function isLineItems(
  value: unknown,
): value is CustomerOrderNode["lineItems"] {
  return (
    value === null ||
    value === undefined ||
    (isRecord(value) &&
      (value.nodes === null ||
        value.nodes === undefined ||
        (Array.isArray(value.nodes) && value.nodes.every(isLineItemNode))))
  );
}

function isLineItemNode(value: unknown): value is CustomerOrderLineItemNode {
  return (
    isRecord(value) &&
    isFiniteNumber(value.quantity) &&
    (value.currentQuantity === undefined ||
      isFiniteNumber(value.currentQuantity)) &&
    typeof value.title === "string" &&
    isCustomAttributes(value.customAttributes) &&
    isSellingPlan(value.sellingPlan) &&
    isVariant(value.variant)
  );
}

function isShopMoney(
  value: unknown,
): value is CustomerOrderNode["currentTotalPriceSet"]["shopMoney"] {
  return (
    isRecord(value) &&
    typeof value.amount === "string" &&
    typeof value.currencyCode === "string"
  );
}

function isCurrentTotalPriceSet(
  value: unknown,
): value is CustomerOrderNode["currentTotalPriceSet"] {
  return isRecord(value) && isShopMoney(value.shopMoney);
}

function isOrderNode(value: unknown): value is CustomerOrderNode {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    isValidDateString(value.processedAt) &&
    isNullableString(value.displayFinancialStatus) &&
    isNullableString(value.displayFulfillmentStatus) &&
    isCurrentTotalPriceSet(value.currentTotalPriceSet) &&
    isFiniteNumber(value.subtotalLineItemsQuantity) &&
    isLineItems(value.lineItems)
  );
}

function readGraphqlErrors(payload: Record<string, unknown>) {
  if (!Array.isArray(payload.errors)) return [];

  return payload.errors.map((error) =>
    isRecord(error) && typeof error.message === "string"
      ? error.message
      : "Unknown GraphQL error",
  );
}

function parseOrdersResponse(payload: unknown): CustomerOrderNode[] {
  if (!isRecord(payload)) {
    throw new Error("Invalid orders response: expected an object.");
  }

  const graphqlErrors = readGraphqlErrors(payload);
  if (graphqlErrors.length > 0) {
    throw new Error(`Orders GraphQL request failed: ${graphqlErrors.join("; ")}`);
  }

  const data = payload.data;
  if (!isRecord(data) || !isRecord(data.orders)) {
    throw new Error("Invalid orders response: missing orders.");
  }

  const nodes = data.orders.nodes;
  if (!Array.isArray(nodes) || !nodes.every(isOrderNode)) {
    throw new Error("Invalid orders response: malformed order data.");
  }

  return nodes;
}

function numericIdFromGid(id: string | null | undefined, prefix: string) {
  const numericId = id?.startsWith(prefix) ? id.slice(prefix.length) : null;
  if (!numericId || !NUMERIC_ID_PATTERN.test(numericId)) return null;

  return Number(numericId);
}

function mapCustomAttributes(
  attributes: Array<{ key: string; value?: string | null }> | null | undefined,
) {
  return Object.fromEntries(
    (attributes ?? []).flatMap((attribute): Array<[string, string]> =>
      attribute.key && attribute.value != null
        ? [[attribute.key, attribute.value]]
        : [],
    ),
  );
}

function mapLineItem(node: CustomerOrderLineItemNode): ReorderLine {
  const variantId = numericIdFromGid(node.variant?.id, VARIANT_GID_PREFIX);

  return {
    variantId,
    sellingPlanId: numericIdFromGid(
      node.sellingPlan?.sellingPlanId,
      SELLING_PLAN_GID_PREFIX,
    ),
    quantity: Math.max(0, node.currentQuantity ?? node.quantity),
    title: node.title,
    available: Boolean(node.variant?.availableForSale),
    properties: mapCustomAttributes(node.customAttributes),
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

function mapFulfillmentStatus(
  raw: string | null | undefined,
): FulfillmentStatus {
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
  const numericAmount = Number(amount);
  if (amount.trim() === "" || !Number.isFinite(numericAmount)) {
    throw new Error("Invalid orders response: malformed money amount.");
  }
  if (!CURRENCY_CODE_PATTERN.test(currencyCode)) {
    throw new Error("Invalid orders response: malformed currency code.");
  }

  return new Intl.NumberFormat(MONEY_DISPLAY_LOCALE, {
    style: "currency",
    currency: currencyCode,
  }).format(numericAmount);
}

function mapOrder(node: CustomerOrderNode): Order {
  const { shopMoney } = node.currentTotalPriceSet;

  return {
    id: node.id,
    number: node.name,
    placedAt: node.processedAt,
    paymentStatus: mapPaymentStatus(node.displayFinancialStatus),
    fulfillmentStatus: mapFulfillmentStatus(node.displayFulfillmentStatus),
    total: formatMoney(shopMoney.amount, shopMoney.currencyCode),
    itemCount: node.subtotalLineItemsQuantity,
    lineItems: (node.lineItems?.nodes ?? []).map(mapLineItem),
  };
}

export async function getCustomerOrders(
  admin: AdminGraphqlClient,
  customerId: string,
) {
  const response = await admin.graphql(CUSTOMER_ORDERS_QUERY, {
    variables: {
      query: `customer_id:${customerId}`,
      first: ORDERS_PAGE_SIZE,
      lineItemsFirst: ORDER_LINE_ITEMS_PAGE_SIZE,
    },
  });

  return parseOrdersResponse(await response.json()).map(mapOrder);
}

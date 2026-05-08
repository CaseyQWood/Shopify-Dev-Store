export type AdminGraphqlClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

type GraphqlError = {
  message?: string;
};

type GraphqlPayload<T> = {
  data?: T;
  errors?: GraphqlError[];
};

export type ShopifyUserError = {
  field?: string[] | null;
  message: string;
};

export class ShopifyGraphqlError extends Error {
  readonly messages: string[];

  constructor(messages: string[]) {
    super(messages.join("; "));
    this.name = "ShopifyGraphqlError";
    this.messages = messages;
  }
}

export async function shopifyGraphql<T>(
  admin: AdminGraphqlClient,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const response = await admin.graphql(query, { variables });
  const payload = (await response.json()) as GraphqlPayload<T>;
  const messages =
    payload.errors?.map((error) => error.message ?? "Unknown GraphQL error") ??
    [];

  if (messages.length > 0) {
    throw new ShopifyGraphqlError(messages);
  }

  if (!payload.data) {
    throw new ShopifyGraphqlError(["Shopify returned an empty GraphQL body."]);
  }

  return payload.data;
}

export function throwUserErrors(
  userErrors: ShopifyUserError[] | null | undefined,
) {
  if (!userErrors || userErrors.length === 0) return;

  throw new ShopifyGraphqlError(
    userErrors.map((error) =>
      error.field?.length
        ? `${error.field.join(".")}: ${error.message}`
        : error.message,
    ),
  );
}

export function formatShopifyError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error.";

  if (isSubscriptionAccessError(message)) {
    return [
      "Subscription API access is not available for this shop session.",
      "Confirm the app has protected subscription access in the Partner Dashboard, the required scopes are approved, and the current admin user can manage order information.",
    ].join(" ");
  }

  return message;
}

export function isSubscriptionAccessError(message: string) {
  const lowerMessage = message.toLowerCase();

  return (
    lowerMessage.includes("access denied") ||
    lowerMessage.includes("protected") ||
    lowerMessage.includes("read_own_subscription_contracts") ||
    lowerMessage.includes("write_own_subscription_contracts") ||
    lowerMessage.includes("manage_orders_information")
  );
}

export function numericIdFromGid(id: string, resource: string) {
  const prefix = `gid://shopify/${resource}/`;
  return id.startsWith(prefix) ? id.slice(prefix.length) : id;
}

export function normalizeGid(value: string, resource: string) {
  const trimmedValue = value.trim();
  if (trimmedValue.startsWith(`gid://shopify/${resource}/`)) {
    return trimmedValue;
  }

  const numericId = trimmedValue.match(/\d+/)?.[0];
  if (!numericId) {
    throw new Error(`Enter a valid ${resource} ID.`);
  }

  return `gid://shopify/${resource}/${numericId}`;
}

export function splitIdList(value: string, resource: string) {
  const ids = value
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => normalizeGid(entry, resource));

  return Array.from(new Set(ids));
}

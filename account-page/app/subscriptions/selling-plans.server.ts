import {
  type AdminGraphqlClient,
  type ShopifyUserError,
  shopifyGraphql,
  throwUserErrors,
} from "./shopify-graphql.server";

const SELLING_PLAN_GROUP_NAME = "Subscribe";
const SELLING_PLAN_GROUP_MERCHANT_CODE = "account-page-subscriptions";
const SELLING_PLAN_GROUP_OPTION = "Delivery frequency";
const MONTHLY_PLAN_NAME = "Monthly";
const BIWEEKLY_PLAN_NAME = "Bi-weekly";

// ---------------------------------------------------------------------------
// Exported Types
// ---------------------------------------------------------------------------

export type SellingPlanInput = {
  name: string;
  interval: "WEEK" | "MONTH";
  intervalCount: number;
};

export type SellingPlanGroupSummary = {
  id: string;
  name: string;
  merchantCode: string;
  description?: string | null;
  appId?: string | null;
  summary?: string | null;
  sellingPlans: {
    nodes: Array<{ id: string; name: string }>;
  };
};

export type SellingPlanGroupDetail = {
  id: string;
  name: string;
  merchantCode: string;
  description?: string | null;
  appId?: string | null;
  summary?: string | null;
  products: {
    nodes: Array<{
      id: string;
      title: string;
      featuredImage?: { url: string; altText?: string | null } | null;
      priceRangeV2: {
        minVariantPrice: { amount: string; currencyCode: string };
        maxVariantPrice: { amount: string; currencyCode: string };
      };
    }>;
  };
  sellingPlans: {
    nodes: Array<{
      id: string;
      name: string;
      billingPolicy: {
        interval: string;
        intervalCount: number;
      };
      deliveryPolicy: {
        interval: string;
        intervalCount: number;
      };
    }>;
  };
};

// ---------------------------------------------------------------------------
// Legacy types kept for internal use
// ---------------------------------------------------------------------------

type SellingPlanGroupNode = {
  id: string;
  name: string;
  merchantCode: string;
  description?: string | null;
  sellingPlans?: {
    nodes?: Array<{
      id: string;
      name: string;
      options?: string[] | null;
    }> | null;
  } | null;
};

type SellingPlanMutationData = {
  sellingPlanGroupCreate?: {
    sellingPlanGroup?: SellingPlanGroupNode | null;
    userErrors: ShopifyUserError[];
  };
  sellingPlanGroupUpdate?: {
    sellingPlanGroup?: SellingPlanGroupNode | null;
    userErrors: ShopifyUserError[];
  };
  sellingPlanGroupAddProducts?: {
    sellingPlanGroup?: SellingPlanGroupNode | null;
    userErrors: ShopifyUserError[];
  };
  sellingPlanGroupRemoveProducts?: {
    removedProductIds?: string[] | null;
    userErrors: ShopifyUserError[];
  };
};

// ---------------------------------------------------------------------------
// GraphQL Constants
// ---------------------------------------------------------------------------

const SELLING_PLAN_GROUPS_LIST_QUERY = `#graphql
  query AccountPageSellingPlanGroupsList {
    sellingPlanGroups(first: 50) {
      nodes {
        id
        name
        merchantCode
        description
        appId
        summary
        sellingPlans(first: 5) {
          nodes {
            id
            name
          }
        }
      }
    }
  }
` as const;

const SELLING_PLAN_GROUP_DETAIL_QUERY = `#graphql
  query AccountPageSellingPlanGroupDetail($id: ID!) {
    sellingPlanGroup(id: $id) {
      id
      name
      merchantCode
      description
      appId
      summary
      products(first: 100) {
        nodes {
          id
          title
          featuredImage {
            url
            altText
          }
          priceRangeV2 {
            minVariantPrice {
              amount
              currencyCode
            }
            maxVariantPrice {
              amount
              currencyCode
            }
          }
        }
      }
      sellingPlans(first: 25) {
        nodes {
          id
          name
          billingPolicy {
            ... on SellingPlanRecurringBillingPolicy {
              interval
              intervalCount
            }
          }
          deliveryPolicy {
            ... on SellingPlanRecurringDeliveryPolicy {
              interval
              intervalCount
            }
          }
        }
      }
    }
  }
` as const;

const SELLING_PLAN_GROUP_CREATE_MUTATION = `#graphql
  mutation AccountPageSellingPlanGroupCreate($input: SellingPlanGroupInput!, $resources: SellingPlanGroupResourceInput) {
    sellingPlanGroupCreate(input: $input, resources: $resources) {
      sellingPlanGroup {
        id
        name
        merchantCode
        sellingPlans(first: 10) {
          nodes {
            id
            name
            options
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
` as const;

const SELLING_PLAN_GROUP_UPDATE_MUTATION = `#graphql
  mutation AccountPageSellingPlanGroupUpdate($id: ID!, $input: SellingPlanGroupInput!) {
    sellingPlanGroupUpdate(id: $id, input: $input) {
      sellingPlanGroup {
        id
        name
        merchantCode
        sellingPlans(first: 10) {
          nodes {
            id
            name
            options
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
` as const;

const SELLING_PLAN_GROUP_ADD_PRODUCTS_MUTATION = `#graphql
  mutation AccountPageSellingPlanGroupAddProducts($id: ID!, $productIds: [ID!]!) {
    sellingPlanGroupAddProducts(id: $id, productIds: $productIds) {
      sellingPlanGroup {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
` as const;

const SELLING_PLAN_GROUP_REMOVE_PRODUCTS_MUTATION = `#graphql
  mutation AccountPageSellingPlanGroupRemoveProducts($id: ID!, $productIds: [ID!]!) {
    sellingPlanGroupRemoveProducts(id: $id, productIds: $productIds) {
      removedProductIds
      userErrors {
        field
        message
      }
    }
  }
` as const;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function sellingPlanInput(name: string, interval: "MONTH" | "WEEK", count: number) {
  return {
    name,
    options: [name],
    position: name === MONTHLY_PLAN_NAME ? 1 : 2,
    category: "SUBSCRIPTION",
    billingPolicy: {
      recurring: {
        interval,
        intervalCount: count,
      },
    },
    deliveryPolicy: {
      recurring: {
        interval,
        intervalCount: count,
      },
    },
    inventoryPolicy: {
      reserve: "ON_SALE",
    },
  };
}

/** Map a public SellingPlanInput to the shape Shopify's mutation expects. */
function toShopifyPlanInput(plan: SellingPlanInput) {
  return {
    name: plan.name,
    options: [plan.name],
    category: "SUBSCRIPTION",
    billingPolicy: {
      recurring: {
        interval: plan.interval,
        intervalCount: plan.intervalCount,
      },
    },
    deliveryPolicy: {
      recurring: {
        interval: plan.interval,
        intervalCount: plan.intervalCount,
      },
    },
    inventoryPolicy: {
      reserve: "ON_SALE",
    },
    pricingPolicies: [
      {
        fixed: {
          adjustmentType: "PERCENTAGE",
          adjustmentValue: { percentage: 0 },
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Exported helpers
// ---------------------------------------------------------------------------

export async function listSellingPlanGroups(
  admin: AdminGraphqlClient,
): Promise<SellingPlanGroupSummary[]> {
  const data = await shopifyGraphql<{
    sellingPlanGroups: { nodes: SellingPlanGroupSummary[] };
  }>(admin, SELLING_PLAN_GROUPS_LIST_QUERY);

  return data.sellingPlanGroups.nodes ?? [];
}

export async function getSellingPlanGroupDetail(
  admin: AdminGraphqlClient,
  groupId: string,
): Promise<SellingPlanGroupDetail | null> {
  const data = await shopifyGraphql<{
    sellingPlanGroup: SellingPlanGroupDetail | null;
  }>(admin, SELLING_PLAN_GROUP_DETAIL_QUERY, { id: groupId });

  return data.sellingPlanGroup ?? null;
}

export async function createSellingPlanGroup(
  admin: AdminGraphqlClient,
  {
    name,
    description,
    productIds,
    plans,
  }: {
    name: string;
    description?: string;
    productIds?: string[];
    plans?: SellingPlanInput[];
  },
): Promise<string> {
  const sellingPlansToCreate = plans
    ? plans.map((p) => sellingPlanInput(p.name, p.interval, p.intervalCount))
    : [
        sellingPlanInput(MONTHLY_PLAN_NAME, "MONTH", 1),
        sellingPlanInput(BIWEEKLY_PLAN_NAME, "WEEK", 2),
      ];

  const input = {
    name,
    merchantCode: name.toLowerCase().replace(/\s+/g, "-"),
    description: description ?? "",
    options: [SELLING_PLAN_GROUP_OPTION],
    position: 1,
    sellingPlansToCreate,
  };

  const resources =
    productIds && productIds.length > 0 ? { productIds } : undefined;

  const data = await shopifyGraphql<SellingPlanMutationData>(
    admin,
    SELLING_PLAN_GROUP_CREATE_MUTATION,
    { input, resources },
  );

  throwUserErrors(data.sellingPlanGroupCreate?.userErrors);
  const group = data.sellingPlanGroupCreate?.sellingPlanGroup;
  if (!group) {
    throw new Error("Shopify did not return the created selling plan group.");
  }

  return group.id;
}

export async function updateSellingPlanGroupBasics(
  admin: AdminGraphqlClient,
  groupId: string,
  { name, description }: { name: string; description?: string },
): Promise<void> {
  const data = await shopifyGraphql<SellingPlanMutationData>(
    admin,
    SELLING_PLAN_GROUP_UPDATE_MUTATION,
    {
      id: groupId,
      input: {
        name,
        ...(description !== undefined ? { description } : {}),
      },
    },
  );

  throwUserErrors(data.sellingPlanGroupUpdate?.userErrors);
}

export async function updateSellingPlanGroupPlans(
  admin: AdminGraphqlClient,
  groupId: string,
  {
    plansToCreate,
    plansToUpdate,
    plansToDelete,
  }: {
    plansToCreate?: SellingPlanInput[];
    plansToUpdate?: Array<SellingPlanInput & { id: string }>;
    plansToDelete?: string[];
  },
): Promise<void> {
  const input: Record<string, unknown> = {};

  if (plansToCreate && plansToCreate.length > 0) {
    input.sellingPlansToCreate = plansToCreate.map(toShopifyPlanInput);
  }
  if (plansToUpdate && plansToUpdate.length > 0) {
    input.sellingPlansToUpdate = plansToUpdate.map((p) => ({
      id: p.id,
      ...toShopifyPlanInput(p),
    }));
  }
  if (plansToDelete && plansToDelete.length > 0) {
    input.sellingPlansToDelete = plansToDelete;
  }

  const data = await shopifyGraphql<SellingPlanMutationData>(
    admin,
    SELLING_PLAN_GROUP_UPDATE_MUTATION,
    { id: groupId, input },
  );

  throwUserErrors(data.sellingPlanGroupUpdate?.userErrors);
}

export async function addProductsToGroup(
  admin: AdminGraphqlClient,
  groupId: string,
  productIds: string[],
): Promise<void> {
  if (productIds.length === 0) return;

  const data = await shopifyGraphql<SellingPlanMutationData>(
    admin,
    SELLING_PLAN_GROUP_ADD_PRODUCTS_MUTATION,
    { id: groupId, productIds },
  );

  throwUserErrors(data.sellingPlanGroupAddProducts?.userErrors);
}

export async function removeProductsFromGroup(
  admin: AdminGraphqlClient,
  groupId: string,
  productIds: string[],
): Promise<void> {
  if (productIds.length === 0) return;

  const data = await shopifyGraphql<SellingPlanMutationData>(
    admin,
    SELLING_PLAN_GROUP_REMOVE_PRODUCTS_MUTATION,
    { id: groupId, productIds },
  );

  throwUserErrors(data.sellingPlanGroupRemoveProducts?.userErrors);
}


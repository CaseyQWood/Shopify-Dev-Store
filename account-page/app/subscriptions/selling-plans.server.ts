import {
  type AdminGraphqlClient,
  type ShopifyUserError,
  normalizeGid,
  shopifyGraphql,
  splitIdList,
  throwUserErrors,
} from "./shopify-graphql.server";

const SELLING_PLAN_GROUP_NAME = "Subscribe";
const SELLING_PLAN_GROUP_MERCHANT_CODE = "account-page-subscriptions";
const SELLING_PLAN_GROUP_OPTION = "Delivery frequency";
const MONTHLY_PLAN_NAME = "Monthly";
const BIWEEKLY_PLAN_NAME = "Bi-weekly";

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
  products?: { nodes?: Array<{ id: string; title: string }> | null } | null;
  productVariants?: {
    nodes?: Array<{ id: string; title: string }> | null;
  } | null;
};

type SellingPlanGroupData = {
  sellingPlanGroups: { nodes?: SellingPlanGroupNode[] | null };
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
  productVariantJoinSellingPlanGroups?: {
    productVariant?: { id: string } | null;
    userErrors: ShopifyUserError[];
  };
};

export type SellingPlanSetupInput = {
  productIdsInput: string;
  productVariantIdsInput: string;
};

export type SellingPlanSetupResult = {
  sellingPlanGroupId: string;
  created: boolean;
  productCount: number;
  productVariantCount: number;
};

const SELLING_PLAN_GROUP_QUERY = `#graphql
  query AccountPageSellingPlanGroup($query: String!) {
    sellingPlanGroups(first: 20, query: $query) {
      nodes {
        id
        name
        merchantCode
        description
        sellingPlans(first: 10) {
          nodes {
            id
            name
            options
          }
        }
        products(first: 10) {
          nodes {
            id
            title
          }
        }
        productVariants(first: 10) {
          nodes {
            id
            title
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

const PRODUCT_VARIANT_JOIN_GROUP_MUTATION = `#graphql
  mutation AccountPageProductVariantJoinSellingPlanGroups($id: ID!, $sellingPlanGroupIds: [ID!]!) {
    productVariantJoinSellingPlanGroups(id: $id, sellingPlanGroupIds: $sellingPlanGroupIds) {
      productVariant {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
` as const;

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

function sellingPlanGroupInput(sellingPlansToCreate = [
  sellingPlanInput(MONTHLY_PLAN_NAME, "MONTH", 1),
  sellingPlanInput(BIWEEKLY_PLAN_NAME, "WEEK", 2),
]) {
  return {
    name: SELLING_PLAN_GROUP_NAME,
    merchantCode: SELLING_PLAN_GROUP_MERCHANT_CODE,
    description: "Monthly and bi-weekly subscription purchase options.",
    options: [SELLING_PLAN_GROUP_OPTION],
    position: 1,
    sellingPlansToCreate,
  };
}

function parseProductIds(input: SellingPlanSetupInput) {
  return {
    productIds: splitIdList(input.productIdsInput, "Product"),
    productVariantIds: splitIdList(input.productVariantIdsInput, "ProductVariant"),
  };
}

function missingPlanInputs(group: SellingPlanGroupNode) {
  const planNames = new Set(
    (group.sellingPlans?.nodes ?? []).map((plan) => plan.name),
  );
  const missingPlans = [
    ...(planNames.has(MONTHLY_PLAN_NAME)
      ? []
      : [sellingPlanInput(MONTHLY_PLAN_NAME, "MONTH", 1)]),
    ...(planNames.has(BIWEEKLY_PLAN_NAME)
      ? []
      : [sellingPlanInput(BIWEEKLY_PLAN_NAME, "WEEK", 2)]),
  ];

  return missingPlans;
}

export async function getSubscriptionSellingPlanGroup(
  admin: AdminGraphqlClient,
) {
  const data = await shopifyGraphql<SellingPlanGroupData>(
    admin,
    SELLING_PLAN_GROUP_QUERY,
    { query: SELLING_PLAN_GROUP_MERCHANT_CODE },
  );

  return (
    data.sellingPlanGroups.nodes?.find(
      (group) => group.merchantCode === SELLING_PLAN_GROUP_MERCHANT_CODE,
    ) ?? null
  );
}

async function createSellingPlanGroup(
  admin: AdminGraphqlClient,
  productIds: string[],
  productVariantIds: string[],
) {
  const data = await shopifyGraphql<SellingPlanMutationData>(
    admin,
    SELLING_PLAN_GROUP_CREATE_MUTATION,
    {
      input: sellingPlanGroupInput(),
      resources: {
        productIds,
        productVariantIds,
      },
    },
  );

  throwUserErrors(data.sellingPlanGroupCreate?.userErrors);
  const group = data.sellingPlanGroupCreate?.sellingPlanGroup;
  if (!group) {
    throw new Error("Shopify did not return the created selling plan group.");
  }

  return group;
}

async function ensureSellingPlanDefinitions(
  admin: AdminGraphqlClient,
  group: SellingPlanGroupNode,
) {
  const missingPlans = missingPlanInputs(group);
  if (missingPlans.length === 0) return group;

  const data = await shopifyGraphql<SellingPlanMutationData>(
    admin,
    SELLING_PLAN_GROUP_UPDATE_MUTATION,
    {
      id: group.id,
      input: {
        name: SELLING_PLAN_GROUP_NAME,
        merchantCode: SELLING_PLAN_GROUP_MERCHANT_CODE,
        options: [SELLING_PLAN_GROUP_OPTION],
        sellingPlansToCreate: missingPlans,
      },
    },
  );

  throwUserErrors(data.sellingPlanGroupUpdate?.userErrors);
  return data.sellingPlanGroupUpdate?.sellingPlanGroup ?? group;
}

async function attachProducts(
  admin: AdminGraphqlClient,
  groupId: string,
  productIds: string[],
) {
  if (productIds.length === 0) return;

  const data = await shopifyGraphql<SellingPlanMutationData>(
    admin,
    SELLING_PLAN_GROUP_ADD_PRODUCTS_MUTATION,
    {
      id: groupId,
      productIds,
    },
  );

  throwUserErrors(data.sellingPlanGroupAddProducts?.userErrors);
}

async function attachProductVariants(
  admin: AdminGraphqlClient,
  groupId: string,
  productVariantIds: string[],
) {
  for (const productVariantId of productVariantIds) {
    const data = await shopifyGraphql<SellingPlanMutationData>(
      admin,
      PRODUCT_VARIANT_JOIN_GROUP_MUTATION,
      {
        id: normalizeGid(productVariantId, "ProductVariant"),
        sellingPlanGroupIds: [groupId],
      },
    );

    throwUserErrors(data.productVariantJoinSellingPlanGroups?.userErrors);
  }
}

export async function setupSubscriptionSellingPlans(
  admin: AdminGraphqlClient,
  input: SellingPlanSetupInput,
): Promise<SellingPlanSetupResult> {
  const { productIds, productVariantIds } = parseProductIds(input);
  if (productIds.length === 0 && productVariantIds.length === 0) {
    throw new Error("Enter at least one product ID or product variant ID.");
  }

  const existingGroup = await getSubscriptionSellingPlanGroup(admin);
  const group = existingGroup
    ? await ensureSellingPlanDefinitions(admin, existingGroup)
    : await createSellingPlanGroup(admin, productIds, productVariantIds);

  if (existingGroup) {
    await attachProducts(admin, group.id, productIds);
    await attachProductVariants(admin, group.id, productVariantIds);
  }

  return {
    sellingPlanGroupId: group.id,
    created: !existingGroup,
    productCount: productIds.length,
    productVariantCount: productVariantIds.length,
  };
}

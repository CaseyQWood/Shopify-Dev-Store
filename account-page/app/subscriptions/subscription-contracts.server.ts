import type { PrismaClient } from "@prisma/client";

import {
  type AdminGraphqlClient,
  type ShopifyUserError,
  normalizeGid,
  numericIdFromGid,
  shopifyGraphql,
  throwUserErrors,
} from "./shopify-graphql.server";

const CONTRACT_PAGE_SIZE = 20;
const CUSTOMER_PAGE_SIZE = 10;
const CUSTOMER_CONTRACT_PAGE_SIZE = 10;
const NEXT_CYCLE_LOOKAHEAD_DAYS = 730;
const DISPLAY_LOCALE = "en-US";
const SHOPIFY_TIME_ZONE = "Z";

type MoneyNode = {
  amount: string;
  currencyCode: string;
};

type SubscriptionPolicyNode = {
  interval?: string | null;
  intervalCount?: number | null;
};

type CustomerNode = {
  id: string;
  displayName?: string | null;
  email?: string | null;
  phone?: string | null;
};

type SubscriptionLineNode = {
  id: string;
  title?: string | null;
  variantTitle?: string | null;
  quantity?: number | null;
  variantId?: string | null;
  productId?: string | null;
  currentPrice?: MoneyNode | null;
  lineDiscountedPrice?: MoneyNode | null;
};

type BillingAttemptNode = {
  id: string;
  ready?: boolean | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  order?: { id: string; name?: string | null } | null;
  processingError?: {
    code?: string | null;
    message?: string | null;
  } | null;
};

type BillingCycleNode = {
  cycleIndex: number;
  billingAttemptExpectedDate: string;
  status?: string | null;
  skipped?: boolean | null;
  edited?: boolean | null;
  billingAttempts?: { nodes?: BillingAttemptNode[] | null } | null;
};

type SubscriptionContractNode = {
  id: string;
  status?: string | null;
  nextBillingDate?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  currencyCode?: string | null;
  lastPaymentStatus?: string | null;
  lastBillingAttemptErrorType?: string | null;
  customer?: CustomerNode | null;
  billingPolicy?: SubscriptionPolicyNode | null;
  deliveryPolicy?: SubscriptionPolicyNode | null;
  lines?: { nodes?: SubscriptionLineNode[] | null } | null;
  billingAttempts?: { nodes?: BillingAttemptNode[] | null } | null;
};

type ContractDetailData = {
  subscriptionContract: SubscriptionContractNode | null;
  subscriptionBillingCycles: { nodes?: BillingCycleNode[] | null };
};

type ContractListData = {
  subscriptionContracts: { nodes?: SubscriptionContractNode[] | null };
};

type CustomerContractsData = {
  customer:
    | (CustomerNode & {
        subscriptionContracts?: {
          nodes?: SubscriptionContractNode[] | null;
        } | null;
      })
    | null;
};

type CustomerSearchData = {
  customers: {
    nodes?: Array<
      CustomerNode & {
        subscriptionContracts?: {
          nodes?: SubscriptionContractNode[] | null;
        } | null;
      }
    > | null;
  };
};

type DraftCreateData = {
  subscriptionContractUpdate: {
    draft?: { id: string } | null;
    userErrors: ShopifyUserError[];
  };
};

type DraftMutationData = {
  subscriptionDraftLineUpdate?: {
    userErrors: ShopifyUserError[];
  };
  subscriptionDraftLineAdd?: {
    userErrors: ShopifyUserError[];
  };
  subscriptionDraftLineRemove?: {
    userErrors: ShopifyUserError[];
  };
  subscriptionDraftCommit?: {
    contract?: { id: string } | null;
    userErrors: ShopifyUserError[];
  };
  subscriptionBillingCycleContractDraftCommit?: {
    contract?: { id: string } | null;
    userErrors: ShopifyUserError[];
  };
};

type ScheduleEditData = {
  subscriptionBillingCycleScheduleEdit: {
    billingCycle?: BillingCycleNode | null;
    userErrors: ShopifyUserError[];
  };
};

type BillingCycleEditData = {
  subscriptionBillingCycleContractEdit: {
    draft?: { id: string } | null;
    userErrors: ShopifyUserError[];
  };
};

export type SubscriptionLine = {
  id: string;
  title: string;
  variantTitle: string | null;
  quantity: number;
  variantId: string | null;
  productId: string | null;
  currentPrice: string | null;
  lineTotal: string | null;
};

export type BillingAttempt = {
  id: string;
  ready: boolean;
  status: string;
  orderName: string | null;
};

export type BillingCycle = {
  cycleIndex: number;
  billingAttemptExpectedDate: string;
  status: string;
  skipped: boolean;
  edited: boolean;
  billingAttempts: BillingAttempt[];
};

export type SubscriptionContract = {
  id: string;
  numericId: string;
  status: string;
  nextBillingDate: string | null;
  displayNextBillingDate: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  customer: {
    id: string | null;
    numericId: string | null;
    displayName: string;
    email: string | null;
    phone: string | null;
  };
  cadence: string;
  lineSummary: string;
  total: string | null;
  lastPaymentStatus: string | null;
  lastBillingAttemptErrorType: string | null;
  lines: SubscriptionLine[];
  recentBillingAttempts: BillingAttempt[];
  upcomingBillingCycles: BillingCycle[];
};

export type RecurringLineInput = {
  contractId: string;
  lineId: string;
  quantity: number;
  productVariantId?: string | null;
  currentPrice?: string | null;
};

export type AddLineInput = {
  contractId: string;
  productVariantId: string;
  quantity: number;
  currentPrice: string;
};

export type AuditInput = {
  shop: string;
  adminEmail?: string | null;
  action: string;
  contractId?: string | null;
  targetId?: string | null;
  status: "SUCCESS" | "ERROR";
  message?: string | null;
  metadata?: Record<string, unknown> | null;
};

const CONTRACT_FRAGMENT = `#graphql
  fragment SubscriptionContractFields on SubscriptionContract {
    id
    status
    nextBillingDate
    createdAt
    updatedAt
    currencyCode
    lastPaymentStatus
    lastBillingAttemptErrorType
    customer {
      id
      displayName
      email
      phone
    }
    billingPolicy {
      interval
      intervalCount
    }
    deliveryPolicy {
      interval
      intervalCount
    }
    lines(first: 25) {
      nodes {
        id
        title
        variantTitle
        quantity
        variantId
        productId
        currentPrice {
          amount
          currencyCode
        }
        lineDiscountedPrice {
          amount
          currencyCode
        }
      }
    }
    billingAttempts(first: 3, reverse: true) {
      nodes {
        id
        ready
        errorCode
        errorMessage
        order {
          id
          name
        }
        processingError {
          code
          message
        }
      }
    }
  }
` as const;

const RECENT_CONTRACTS_QUERY = `#graphql
  ${CONTRACT_FRAGMENT}
  query RecentSubscriptionContracts($first: Int!) {
    subscriptionContracts(first: $first, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        ...SubscriptionContractFields
      }
    }
  }
` as const;

const CONTRACT_DETAIL_QUERY = `#graphql
  ${CONTRACT_FRAGMENT}
  query SubscriptionContractDetail($id: ID!, $cycleStart: DateTime!, $cycleEnd: DateTime!) {
    subscriptionContract(id: $id) {
      ...SubscriptionContractFields
    }
    subscriptionBillingCycles(
      first: 6
      contractId: $id
      sortKey: CYCLE_INDEX
      billingCyclesDateRangeSelector: {startDate: $cycleStart, endDate: $cycleEnd}
    ) {
      nodes {
        cycleIndex
        billingAttemptExpectedDate
        status
        skipped
        edited
        billingAttempts(first: 3, reverse: true) {
          nodes {
            id
            ready
            errorCode
            errorMessage
            order {
              id
              name
            }
            processingError {
              code
              message
            }
          }
        }
      }
    }
  }
` as const;

const CUSTOMER_CONTRACTS_QUERY = `#graphql
  ${CONTRACT_FRAGMENT}
  query CustomerSubscriptionContracts($customerId: ID!, $first: Int!) {
    customer(id: $customerId) {
      id
      displayName
      email
      phone
      subscriptionContracts(first: $first) {
        nodes {
          ...SubscriptionContractFields
        }
      }
    }
  }
` as const;

const CUSTOMER_SEARCH_QUERY = `#graphql
  ${CONTRACT_FRAGMENT}
  query CustomerSubscriptionSearch($query: String!, $first: Int!, $contractsFirst: Int!) {
    customers(first: $first, query: $query) {
      nodes {
        id
        displayName
        email
        phone
        subscriptionContracts(first: $contractsFirst) {
          nodes {
            ...SubscriptionContractFields
          }
        }
      }
    }
  }
` as const;

const NEXT_BILLING_CYCLE_QUERY = `#graphql
  query NextSubscriptionBillingCycle($contractId: ID!, $cycleStart: DateTime!, $cycleEnd: DateTime!) {
    subscriptionBillingCycles(
      first: 10
      contractId: $contractId
      sortKey: CYCLE_INDEX
      billingCyclesDateRangeSelector: {startDate: $cycleStart, endDate: $cycleEnd}
    ) {
      nodes {
        cycleIndex
        billingAttemptExpectedDate
        status
        skipped
        edited
      }
    }
  }
` as const;

const SUBSCRIPTION_CONTRACT_UPDATE_MUTATION = `#graphql
  mutation SubscriptionContractUpdate($contractId: ID!) {
    subscriptionContractUpdate(contractId: $contractId) {
      draft {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
` as const;

const SUBSCRIPTION_DRAFT_LINE_UPDATE_MUTATION = `#graphql
  mutation SubscriptionDraftLineUpdate($draftId: ID!, $lineId: ID!, $input: SubscriptionLineUpdateInput!) {
    subscriptionDraftLineUpdate(draftId: $draftId, lineId: $lineId, input: $input) {
      lineUpdated {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
` as const;

const SUBSCRIPTION_DRAFT_LINE_ADD_MUTATION = `#graphql
  mutation SubscriptionDraftLineAdd($draftId: ID!, $input: SubscriptionLineInput!) {
    subscriptionDraftLineAdd(draftId: $draftId, input: $input) {
      lineAdded {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
` as const;

const SUBSCRIPTION_DRAFT_LINE_REMOVE_MUTATION = `#graphql
  mutation SubscriptionDraftLineRemove($draftId: ID!, $lineId: ID!) {
    subscriptionDraftLineRemove(draftId: $draftId, lineId: $lineId) {
      lineRemoved {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
` as const;

const SUBSCRIPTION_DRAFT_COMMIT_MUTATION = `#graphql
  mutation SubscriptionDraftCommit($draftId: ID!) {
    subscriptionDraftCommit(draftId: $draftId) {
      contract {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
` as const;

const SCHEDULE_EDIT_MUTATION = `#graphql
  mutation SubscriptionBillingCycleScheduleEdit(
    $contractId: ID!
    $index: Int!
    $input: SubscriptionBillingCycleScheduleEditInput!
  ) {
    subscriptionBillingCycleScheduleEdit(
      billingCycleInput: {contractId: $contractId, selector: {index: $index}}
      input: $input
    ) {
      billingCycle {
        cycleIndex
        billingAttemptExpectedDate
        skipped
        status
      }
      userErrors {
        field
        message
      }
    }
  }
` as const;

const BILLING_CYCLE_CONTRACT_EDIT_MUTATION = `#graphql
  mutation SubscriptionBillingCycleContractEdit($billingCycleInput: SubscriptionBillingCycleInput!) {
    subscriptionBillingCycleContractEdit(billingCycleInput: $billingCycleInput) {
      draft {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
` as const;

const BILLING_CYCLE_DRAFT_COMMIT_MUTATION = `#graphql
  mutation SubscriptionBillingCycleContractDraftCommit($draftId: ID!) {
    subscriptionBillingCycleContractDraftCommit(draftId: $draftId) {
      contract {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
` as const;

function formatMoney(money: MoneyNode | null | undefined) {
  if (!money) return null;

  const amount = Number(money.amount);
  if (!Number.isFinite(amount)) return null;

  return new Intl.NumberFormat(DISPLAY_LOCALE, {
    style: "currency",
    currency: money.currencyCode,
  }).format(amount);
}

function formatInterval(policy: SubscriptionPolicyNode | null | undefined) {
  if (!policy?.interval) return null;

  const count = Math.max(1, policy.intervalCount ?? 1);
  const interval = policy.interval.toLowerCase();
  const plural = count === 1 ? interval : `${interval}s`;

  return count === 1 ? `Every ${interval}` : `Every ${count} ${plural}`;
}

function mapBillingAttempt(node: BillingAttemptNode): BillingAttempt {
  const errorMessage =
    node.processingError?.message ?? node.errorMessage ?? node.errorCode;

  return {
    id: node.id,
    ready: Boolean(node.ready),
    status: node.order
      ? `Order ${node.order.name ?? numericIdFromGid(node.order.id, "Order")}`
      : (errorMessage ?? (node.ready ? "Ready" : "Processing")),
    orderName: node.order?.name ?? null,
  };
}

function mapLine(node: SubscriptionLineNode): SubscriptionLine {
  return {
    id: node.id,
    title: node.title ?? "Untitled product",
    variantTitle: node.variantTitle ?? null,
    quantity: Math.max(0, node.quantity ?? 0),
    variantId: node.variantId ?? null,
    productId: node.productId ?? null,
    currentPrice: formatMoney(node.currentPrice),
    lineTotal: formatMoney(node.lineDiscountedPrice),
  };
}

function mapBillingCycle(node: BillingCycleNode): BillingCycle {
  return {
    cycleIndex: node.cycleIndex,
    billingAttemptExpectedDate: node.billingAttemptExpectedDate,
    status: node.status ?? "UNKNOWN",
    skipped: Boolean(node.skipped),
    edited: Boolean(node.edited),
    billingAttempts: (node.billingAttempts?.nodes ?? []).map(mapBillingAttempt),
  };
}

function selectNextBillableCycleDate(
  cycles: BillingCycleNode[],
  fallbackDate: string | null,
) {
  const nextBillableCycle = cycles.find(
    (cycle) => cycle.status === "UNBILLED" && cycle.skipped !== true,
  );

  return nextBillableCycle?.billingAttemptExpectedDate ?? fallbackDate;
}

function mapContract(
  node: SubscriptionContractNode,
  cycles: BillingCycleNode[] = [],
): SubscriptionContract {
  const currencyCode = node.currencyCode ?? "USD";
  const lines = (node.lines?.nodes ?? []).map(mapLine);
  const customerId = node.customer?.id ?? null;

  return {
    id: node.id,
    numericId: numericIdFromGid(node.id, "SubscriptionContract"),
    status: node.status ?? "UNKNOWN",
    nextBillingDate: node.nextBillingDate ?? null,
    displayNextBillingDate: selectNextBillableCycleDate(
      cycles,
      node.nextBillingDate ?? null,
    ),
    createdAt: node.createdAt ?? null,
    updatedAt: node.updatedAt ?? null,
    customer: {
      id: customerId,
      numericId: customerId ? numericIdFromGid(customerId, "Customer") : null,
      displayName: node.customer?.displayName ?? "Unknown customer",
      email: node.customer?.email ?? null,
      phone: node.customer?.phone ?? null,
    },
    cadence:
      formatInterval(node.billingPolicy) ??
      formatInterval(node.deliveryPolicy) ??
      "Cadence unavailable",
    lineSummary: summarizeLines(lines),
    total: summarizeTotal(lines, currencyCode),
    lastPaymentStatus: node.lastPaymentStatus ?? null,
    lastBillingAttemptErrorType: node.lastBillingAttemptErrorType ?? null,
    lines,
    recentBillingAttempts: (node.billingAttempts?.nodes ?? []).map(
      mapBillingAttempt,
    ),
    upcomingBillingCycles: cycles.map(mapBillingCycle),
  };
}

function summarizeLines(lines: SubscriptionLine[]) {
  if (lines.length === 0) return "No recurring lines";

  const [firstLine, ...remainingLines] = lines;
  const suffix =
    remainingLines.length === 0 ? "" : ` + ${remainingLines.length} more`;

  return `${firstLine.quantity} x ${firstLine.title}${suffix}`;
}

function summarizeTotal(lines: SubscriptionLine[], currencyCode: string) {
  const total = lines.reduce((sum, line) => {
    const amount = line.lineTotal?.replace(/[^0-9.-]/g, "");
    const parsedAmount = amount ? Number(amount) : NaN;

    return Number.isFinite(parsedAmount) ? sum + parsedAmount : sum;
  }, 0);

  if (!lines.find((line) => line.lineTotal) || total <= 0) return null;

  return new Intl.NumberFormat(DISPLAY_LOCALE, {
    style: "currency",
    currency: currencyCode,
  }).format(total);
}

function dateRangeFromNow(days: number) {
  const now = new Date();
  const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  return {
    cycleStart: now.toISOString().replace("Z", SHOPIFY_TIME_ZONE),
    cycleEnd: end.toISOString().replace("Z", SHOPIFY_TIME_ZONE),
  };
}

function dedupeContracts(contracts: SubscriptionContract[]) {
  const deduped = new Map<string, SubscriptionContract>();
  for (const contract of contracts) {
    deduped.set(contract.id, contract);
  }

  return Array.from(deduped.values());
}

async function enrichContractsWithDisplayNextBillingDate(
  admin: AdminGraphqlClient,
  contracts: SubscriptionContract[],
) {
  const nextBillableCycles = await Promise.all(
    contracts.map(async (contract) => ({
      contractId: contract.id,
      cycle: await findNextBillingCycle(admin, contract.id),
    })),
  );

  const nextBillableDateByContractId = new Map(
    nextBillableCycles.map(({ contractId, cycle }) => [
      contractId,
      cycle?.billingAttemptExpectedDate ?? null,
    ]),
  );

  return contracts.map((contract) => ({
    ...contract,
    displayNextBillingDate:
      nextBillableDateByContractId.get(contract.id) ?? contract.nextBillingDate,
  }));
}

function looksLikeSubscriptionContractId(value: string) {
  return (
    /^\d+$/.test(value) ||
    value.startsWith("gid://shopify/SubscriptionContract/")
  );
}

function looksLikeCustomerId(value: string) {
  return /^\d+$/.test(value) || value.startsWith("gid://shopify/Customer/");
}

function buildLineInput(input: AddLineInput) {
  return {
    productVariantId: normalizeGid(input.productVariantId, "ProductVariant"),
    quantity: input.quantity,
    currentPrice: input.currentPrice,
  };
}

async function createContractDraft(
  admin: AdminGraphqlClient,
  contractId: string,
) {
  const data = await shopifyGraphql<DraftCreateData>(
    admin,
    SUBSCRIPTION_CONTRACT_UPDATE_MUTATION,
    { contractId },
  );

  throwUserErrors(data.subscriptionContractUpdate.userErrors);
  const draftId = data.subscriptionContractUpdate.draft?.id;
  if (!draftId) {
    throw new Error("Shopify did not return a subscription draft.");
  }

  return draftId;
}

async function commitContractDraft(admin: AdminGraphqlClient, draftId: string) {
  const data = await shopifyGraphql<DraftMutationData>(
    admin,
    SUBSCRIPTION_DRAFT_COMMIT_MUTATION,
    { draftId },
  );

  throwUserErrors(data.subscriptionDraftCommit?.userErrors);
}

export async function listRecentSubscriptionContracts(
  admin: AdminGraphqlClient,
) {
  const data = await shopifyGraphql<ContractListData>(
    admin,
    RECENT_CONTRACTS_QUERY,
    { first: CONTRACT_PAGE_SIZE },
  );

  const contracts = (data.subscriptionContracts.nodes ?? []).map((node) =>
    mapContract(node),
  );

  return enrichContractsWithDisplayNextBillingDate(admin, contracts);
}

export async function getSubscriptionContractDetail(
  admin: AdminGraphqlClient,
  contractId: string,
) {
  const normalizedContractId = normalizeGid(contractId, "SubscriptionContract");
  const data = await shopifyGraphql<ContractDetailData>(
    admin,
    CONTRACT_DETAIL_QUERY,
    {
      id: normalizedContractId,
      ...dateRangeFromNow(NEXT_CYCLE_LOOKAHEAD_DAYS),
    },
  );

  if (!data.subscriptionContract) return null;

  return mapContract(
    data.subscriptionContract,
    data.subscriptionBillingCycles.nodes ?? [],
  );
}

export async function getCustomerSubscriptionContracts(
  admin: AdminGraphqlClient,
  customerId: string,
) {
  const data = await shopifyGraphql<CustomerContractsData>(
    admin,
    CUSTOMER_CONTRACTS_QUERY,
    {
      customerId: normalizeGid(customerId, "Customer"),
      first: CUSTOMER_CONTRACT_PAGE_SIZE,
    },
  );

  const contracts = (data.customer?.subscriptionContracts?.nodes ?? []).map((node) =>
    mapContract(node),
  );

  return enrichContractsWithDisplayNextBillingDate(admin, contracts);
}

export async function searchSubscriptionContracts(
  admin: AdminGraphqlClient,
  query: string,
) {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return listRecentSubscriptionContracts(admin);
  }

  const directContract = looksLikeSubscriptionContractId(trimmedQuery)
    ? await getSubscriptionContractDetail(admin, trimmedQuery)
    : null;

  const directCustomerContracts = looksLikeCustomerId(trimmedQuery)
    ? await getCustomerSubscriptionContracts(admin, trimmedQuery)
    : [];

  const customerSearch = await shopifyGraphql<CustomerSearchData>(
    admin,
    CUSTOMER_SEARCH_QUERY,
    {
      query: trimmedQuery,
      first: CUSTOMER_PAGE_SIZE,
      contractsFirst: CUSTOMER_CONTRACT_PAGE_SIZE,
    },
  );

  const customerContracts = (customerSearch.customers.nodes ?? []).flatMap(
    (customer) => customer.subscriptionContracts?.nodes ?? [],
  );

  const contracts = dedupeContracts([
    ...(directContract ? [directContract] : []),
    ...directCustomerContracts,
    ...customerContracts.map((node) => mapContract(node)),
  ]);

  return enrichContractsWithDisplayNextBillingDate(admin, contracts);
}

export async function findNextBillingCycle(
  admin: AdminGraphqlClient,
  contractId: string,
) {
  const data = await shopifyGraphql<{
    subscriptionBillingCycles: { nodes?: BillingCycleNode[] | null };
  }>(admin, NEXT_BILLING_CYCLE_QUERY, {
    contractId,
    ...dateRangeFromNow(NEXT_CYCLE_LOOKAHEAD_DAYS),
  });

  return (data.subscriptionBillingCycles.nodes ?? []).find(
    (cycle) => cycle.status === "UNBILLED" && !cycle.skipped,
  );
}

export async function skipNextBillingCycle(
  admin: AdminGraphqlClient,
  contractId: string,
) {
  const normalizedContractId = normalizeGid(contractId, "SubscriptionContract");
  const cycle = await findNextBillingCycle(admin, normalizedContractId);
  if (!cycle) {
    throw new Error("No upcoming unbilled cycle was found for this contract.");
  }

  const data = await shopifyGraphql<ScheduleEditData>(
    admin,
    SCHEDULE_EDIT_MUTATION,
    {
      contractId: normalizedContractId,
      index: cycle.cycleIndex,
      input: { skip: true, reason: "MERCHANT_INITIATED" },
    },
  );

  throwUserErrors(data.subscriptionBillingCycleScheduleEdit.userErrors);
  return data.subscriptionBillingCycleScheduleEdit.billingCycle;
}

export async function changeNextBillingDate(
  admin: AdminGraphqlClient,
  contractId: string,
  billingDate: string,
) {
  const normalizedContractId = normalizeGid(contractId, "SubscriptionContract");
  const parsedDate = new Date(billingDate);
  if (Number.isNaN(parsedDate.getTime())) {
    throw new Error("Enter a valid next billing date.");
  }

  const cycle = await findNextBillingCycle(admin, normalizedContractId);
  if (!cycle) {
    throw new Error("No upcoming unbilled cycle was found for this contract.");
  }

  const data = await shopifyGraphql<ScheduleEditData>(
    admin,
    SCHEDULE_EDIT_MUTATION,
    {
      contractId: normalizedContractId,
      index: cycle.cycleIndex,
      input: {
        billingDate: parsedDate.toISOString(),
        reason: "MERCHANT_INITIATED",
      },
    },
  );

  throwUserErrors(data.subscriptionBillingCycleScheduleEdit.userErrors);
  return data.subscriptionBillingCycleScheduleEdit.billingCycle;
}

export async function updateRecurringLine(
  admin: AdminGraphqlClient,
  input: RecurringLineInput,
) {
  const contractId = normalizeGid(input.contractId, "SubscriptionContract");
  const draftId = await createContractDraft(admin, contractId);
  const lineInput = {
    quantity: input.quantity,
    ...(input.productVariantId
      ? {
          productVariantId: normalizeGid(
            input.productVariantId,
            "ProductVariant",
          ),
        }
      : {}),
    ...(input.currentPrice ? { currentPrice: input.currentPrice } : {}),
  };
  const data = await shopifyGraphql<DraftMutationData>(
    admin,
    SUBSCRIPTION_DRAFT_LINE_UPDATE_MUTATION,
    {
      draftId,
      lineId: normalizeGid(input.lineId, "SubscriptionLine"),
      input: lineInput,
    },
  );

  throwUserErrors(data.subscriptionDraftLineUpdate?.userErrors);
  await commitContractDraft(admin, draftId);
}

export async function addRecurringLine(
  admin: AdminGraphqlClient,
  input: AddLineInput,
) {
  const contractId = normalizeGid(input.contractId, "SubscriptionContract");
  const draftId = await createContractDraft(admin, contractId);
  const data = await shopifyGraphql<DraftMutationData>(
    admin,
    SUBSCRIPTION_DRAFT_LINE_ADD_MUTATION,
    {
      draftId,
      input: buildLineInput(input),
    },
  );

  throwUserErrors(data.subscriptionDraftLineAdd?.userErrors);
  await commitContractDraft(admin, draftId);
}

export async function removeRecurringLine(
  admin: AdminGraphqlClient,
  contractId: string,
  lineId: string,
) {
  const draftId = await createContractDraft(
    admin,
    normalizeGid(contractId, "SubscriptionContract"),
  );
  const data = await shopifyGraphql<DraftMutationData>(
    admin,
    SUBSCRIPTION_DRAFT_LINE_REMOVE_MUTATION,
    {
      draftId,
      lineId: normalizeGid(lineId, "SubscriptionLine"),
    },
  );

  throwUserErrors(data.subscriptionDraftLineRemove?.userErrors);
  await commitContractDraft(admin, draftId);
}

export async function addOneTimeLineToNextCycle(
  admin: AdminGraphqlClient,
  input: AddLineInput,
) {
  const contractId = normalizeGid(input.contractId, "SubscriptionContract");
  const cycle = await findNextBillingCycle(admin, contractId);
  if (!cycle) {
    throw new Error("No upcoming unbilled cycle was found for this contract.");
  }

  const editData = await shopifyGraphql<BillingCycleEditData>(
    admin,
    BILLING_CYCLE_CONTRACT_EDIT_MUTATION,
    {
      billingCycleInput: {
        contractId,
        selector: { index: cycle.cycleIndex },
      },
    },
  );

  throwUserErrors(editData.subscriptionBillingCycleContractEdit.userErrors);
  const draftId = editData.subscriptionBillingCycleContractEdit.draft?.id;
  if (!draftId) {
    throw new Error("Shopify did not return a billing cycle draft.");
  }

  const lineData = await shopifyGraphql<DraftMutationData>(
    admin,
    SUBSCRIPTION_DRAFT_LINE_ADD_MUTATION,
    {
      draftId,
      input: buildLineInput(input),
    },
  );

  throwUserErrors(lineData.subscriptionDraftLineAdd?.userErrors);

  const commitData = await shopifyGraphql<DraftMutationData>(
    admin,
    BILLING_CYCLE_DRAFT_COMMIT_MUTATION,
    { draftId },
  );

  throwUserErrors(
    commitData.subscriptionBillingCycleContractDraftCommit?.userErrors,
  );
}

export async function recordSubscriptionAdminAction(
  prisma: PrismaClient,
  input: AuditInput,
) {
  await prisma.subscriptionAdminActionAudit.create({
    data: {
      shop: input.shop,
      adminEmail: input.adminEmail ?? null,
      action: input.action,
      contractId: input.contractId ?? null,
      targetId: input.targetId ?? null,
      status: input.status,
      message: input.message ?? null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    },
  });
}

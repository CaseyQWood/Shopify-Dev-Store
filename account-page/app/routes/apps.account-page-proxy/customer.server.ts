type AdminGraphqlClient = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export type CustomerProfile = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  defaultAddress: CustomerAddress | null;
};

export type CustomerAddress = {
  id: string;
  name: string;
  line1: string;
  line2: string | null;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  isDefault: boolean;
};

const CUSTOMER_QUERY = `#graphql
  query CustomerForAccountPage($id: ID!) {
    customer(id: $id) {
      id
      firstName
      lastName
      email
      phone
      defaultAddress {
        id
        firstName
        lastName
        name
        address1
        address2
        city
        provinceCode
        province
        zip
        country
      }
      addresses(first: 25) {
        id
        firstName
        lastName
        name
        address1
        address2
        city
        provinceCode
        province
        zip
        country
      }
    }
  }
`;

type AddressNode = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  name: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  provinceCode: string | null;
  province: string | null;
  zip: string | null;
  country: string | null;
};

type CustomerNode = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  defaultAddress: AddressNode | null;
  addresses: AddressNode[];
};

function mapAddress(node: AddressNode | null, defaultId: string | null): CustomerAddress | null {
  if (!node) return null;
  const name =
    node.name ?? [node.firstName, node.lastName].filter(Boolean).join(" ").trim();
  return {
    id: node.id,
    name: name || "",
    line1: node.address1 ?? "",
    line2: node.address2,
    city: node.city ?? "",
    region: node.provinceCode ?? node.province ?? "",
    postalCode: node.zip ?? "",
    country: node.country ?? "",
    isDefault: defaultId !== null && node.id === defaultId,
  };
}

export async function fetchCustomerProfile(
  admin: AdminGraphqlClient,
  customerId: string,
): Promise<{ user: CustomerProfile | null; addresses: CustomerAddress[] }> {
  const gid = customerId.startsWith("gid://")
    ? customerId
    : `gid://shopify/Customer/${customerId}`;

  const response = await admin.graphql(CUSTOMER_QUERY, {
    variables: { id: gid },
  });
  const payload = (await response.json()) as { data?: { customer: CustomerNode | null } };
  const customer = payload.data?.customer;
  if (!customer) {
    return { user: null, addresses: [] };
  }

  const defaultId = customer.defaultAddress?.id ?? null;
  const addresses = customer.addresses
    .map((addr) => mapAddress(addr, defaultId))
    .filter((a): a is CustomerAddress => a !== null);

  const user: CustomerProfile = {
    firstName: customer.firstName ?? "",
    lastName: customer.lastName ?? "",
    email: customer.email ?? "",
    phone: customer.phone ?? "",
    defaultAddress: mapAddress(customer.defaultAddress, defaultId),
  };

  return { user, addresses };
}

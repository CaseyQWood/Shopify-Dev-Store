export type MockAddress = {
  id: string;
  name: string;
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  isDefault: boolean;
};

export type MockUser = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  defaultAddress: MockAddress;
};

export type MockOrder = {
  id: string;
  number: string;
  placedAt: string;
  paymentStatus: "Paid" | "Pending" | "Refunded";
  fulfillmentStatus: "Fulfilled" | "Unfulfilled" | "In transit";
  total: string;
  itemCount: number;
};

export type MockSubscription = {
  id: string;
  name: string;
  status: "Active" | "Paused" | "Cancelled";
  interval: string;
  nextChargeAt: string;
  price: string;
};

const DEFAULT_ADDRESS: MockAddress = {
  id: "addr_1",
  name: "Casey Wood",
  line1: "123 Maple Street",
  line2: "Apt 4B",
  city: "Portland",
  region: "OR",
  postalCode: "97205",
  country: "United States",
  isDefault: true,
};

const SECOND_ADDRESS: MockAddress = {
  id: "addr_2",
  name: "Casey Wood",
  line1: "500 Industrial Way",
  city: "Seattle",
  region: "WA",
  postalCode: "98101",
  country: "United States",
  isDefault: false,
};

export function getMockUser(): MockUser {
  return {
    firstName: "Casey",
    lastName: "Wood",
    email: "casey@example.com",
    phone: "+1 (555) 123-4567",
    defaultAddress: DEFAULT_ADDRESS,
  };
}

export function getMockAddresses(): MockAddress[] {
  return [DEFAULT_ADDRESS, SECOND_ADDRESS];
}

export function getMockOrders(): MockOrder[] {
  return [
    {
      id: "gid://Order/1001",
      number: "#1001",
      placedAt: "2026-04-12",
      paymentStatus: "Paid",
      fulfillmentStatus: "Fulfilled",
      total: "$128.40",
      itemCount: 3,
    },
    {
      id: "gid://Order/1002",
      number: "#1002",
      placedAt: "2026-03-28",
      paymentStatus: "Paid",
      fulfillmentStatus: "In transit",
      total: "$54.00",
      itemCount: 1,
    },
    {
      id: "gid://Order/1003",
      number: "#1003",
      placedAt: "2026-02-14",
      paymentStatus: "Refunded",
      fulfillmentStatus: "Fulfilled",
      total: "$22.95",
      itemCount: 1,
    },
  ];
}

export function getMockSubscriptions(): MockSubscription[] {
  return [
    {
      id: "sub_1",
      name: "Monthly Coffee Club",
      status: "Active",
      interval: "Every 4 weeks",
      nextChargeAt: "2026-05-03",
      price: "$32.00",
    },
    {
      id: "sub_2",
      name: "Quarterly Skincare Box",
      status: "Paused",
      interval: "Every 3 months",
      nextChargeAt: "2026-07-10",
      price: "$75.00",
    },
  ];
}

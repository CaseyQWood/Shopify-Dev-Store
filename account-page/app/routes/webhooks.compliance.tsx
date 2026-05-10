import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// Shopify GDPR compliance webhooks. All three (customers/data_request,
// customers/redact, shop/redact) share this dispatcher.
//
// This app does not store customer PII directly: subscription snapshots and
// audit rows reference only Shopify customer GIDs. For data_request we have
// nothing to send back; for redact we drop rows keyed by the affected
// customer/shop so the GIDs no longer link back here.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} compliance webhook for ${shop}`);

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST": {
      // No app-side PII to return. Logging is sufficient acknowledgement;
      // merchant fulfils the data request from Shopify-side records.
      return new Response();
    }

    case "CUSTOMERS_REDACT": {
      const customerGid = extractCustomerGid(payload);
      if (customerGid) {
        await db.subscriptionSnapshot.deleteMany({
          where: { shop, customerId: customerGid },
        });
      }
      return new Response();
    }

    case "SHOP_REDACT": {
      await db.$transaction([
        db.subscriptionSnapshot.deleteMany({ where: { shop } }),
        db.subscriptionAdminActionAudit.deleteMany({ where: { shop } }),
        db.subscriptionRenewalRun.deleteMany({ where: { shop } }),
        db.session.deleteMany({ where: { shop } }),
      ]);
      return new Response();
    }

    default:
      return new Response("Unhandled compliance topic", { status: 400 });
  }
};

function extractCustomerGid(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const customer = (payload as { customer?: { id?: number | string } }).customer;
  if (!customer?.id) return null;
  return `gid://shopify/Customer/${customer.id}`;
}

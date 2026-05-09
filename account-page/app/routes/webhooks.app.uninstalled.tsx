import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { captureSnapshot } from "../subscriptions/subscription-snapshots.server";

// ---------------------------------------------------------------------------
// GraphQL — list active contracts for final snapshot sweep.
// We use a minimal query here to avoid pulling in the full contract-detail
// module; captureSnapshot will do the heavy fetch per-contract.
// ---------------------------------------------------------------------------
const ACTIVE_CONTRACT_IDS_QUERY = `#graphql
  query UninstallActiveContracts($first: Int!, $after: String) {
    subscriptionContracts(first: $first, after: $after, query: "status:ACTIVE") {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
      }
    }
  }
`;

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic, admin } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after the app has already
  // been uninstalled. If this webhook already ran, the session may have been
  // deleted previously.
  if (session) {
    // ------------------------------------------------------------------
    // Capture a final snapshot for every active contract before we lose
    // the session credentials.
    // ------------------------------------------------------------------
    if (admin) {
      let after: string | null = null;
      let capturedCount = 0;
      let errorCount = 0;

      do {
        let connection: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: Array<{ id: string }>;
        };

        try {
          const response = await admin.graphql(ACTIVE_CONTRACT_IDS_QUERY, {
            variables: { first: 50, after },
          });
          const payload = (await response.json()) as {
            data: {
              subscriptionContracts: {
                pageInfo: { hasNextPage: boolean; endCursor: string | null };
                nodes: Array<{ id: string }>;
              };
            };
          };
          connection = payload.data.subscriptionContracts;
        } catch (err) {
          console.error(
            `[uninstall-webhook] failed to list contracts for ${shop}:`,
            err,
          );
          break;
        }

        for (const node of connection.nodes) {
          try {
            await captureSnapshot(db, admin, shop, node.id);
            capturedCount++;
          } catch (err) {
            errorCount++;
            console.error(
              `[uninstall-webhook] snapshot failed for contract ${node.id}:`,
              err,
            );
          }
        }

        after = connection.pageInfo.hasNextPage
          ? connection.pageInfo.endCursor
          : null;
      } while (after);

      if (capturedCount > 0 || errorCount > 0) {
        console.log(
          `[uninstall-webhook] ${shop}: final snapshots captured=${capturedCount} errors=${errorCount}`,
        );
      }
    }

    await db.session.deleteMany({ where: { shop } });
  }

  return new Response();
};

import { authenticate } from "./shopify.server";

export const APP_PROXY_PATH_PREFIX = "/apps/account-page-proxy";

type AppProxyContext = Awaited<ReturnType<typeof authenticate.public.appProxy>>;

type AppProxyRequestContext = AppProxyContext & {
  customerId: string | null;
  pathPrefix: string;
  shop: string | null;
};

const CUSTOMER_ID_PATTERN = /^\d+$/;

export function normalizeAppProxyPathPrefix(pathPrefix: string | null) {
  const normalized = pathPrefix?.replace(/\/+$/, "");

  return normalized === APP_PROXY_PATH_PREFIX
    ? normalized
    : APP_PROXY_PATH_PREFIX;
}

function parseCustomerId(customerId: string | null) {
  if (!customerId) return null;
  if (!CUSTOMER_ID_PATTERN.test(customerId)) {
    throw new Response("invalid-customer", { status: 400 });
  }

  return customerId;
}

export async function authenticateAppProxyRequest(
  request: Request,
): Promise<AppProxyRequestContext> {
  const context = await authenticate.public.appProxy(request);
  const url = new URL(request.url);

  return {
    ...context,
    customerId: parseCustomerId(url.searchParams.get("logged_in_customer_id")),
    pathPrefix: normalizeAppProxyPathPrefix(url.searchParams.get("path_prefix")),
    shop: url.searchParams.get("shop"),
  };
}

export async function authenticateLoggedInCustomerAppProxyRequest(
  request: Request,
) {
  const context = await authenticateAppProxyRequest(request);
  if (!context.customerId) {
    throw new Response("not-signed-in", { status: 401 });
  }

  return { ...context, customerId: context.customerId };
}

export async function authenticateCustomerAdminAppProxyRequest(
  request: Request,
) {
  const context = await authenticateLoggedInCustomerAppProxyRequest(request);
  if (!context.session || !context.admin) {
    throw new Response("not-signed-in", { status: 401 });
  }

  return {
    ...context,
    admin: context.admin,
    session: context.session,
  };
}

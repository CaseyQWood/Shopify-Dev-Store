import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

import { authenticateAppProxyRequest } from "../../app-proxy.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { pathPrefix } = await authenticateAppProxyRequest(request);

  throw redirect(`${pathPrefix}/orders`);
};

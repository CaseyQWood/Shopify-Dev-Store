import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const pathPrefix = url.searchParams.get("path_prefix") ?? "";
  throw redirect(`${pathPrefix}/orders`);
};

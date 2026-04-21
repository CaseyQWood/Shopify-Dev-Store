import { authenticate } from "../shopify.server";
import { useLoaderData } from "react-router";

export const loader = async ({ request }) => {
    // Use the authentication API from the React Router template
    await authenticate.public.appProxy(request);

    // Read URL parameters added by Shopify when proxying
    const url = new URL(request.url);

    return {
        shop: url.searchParams.get("shop"),
        loggedInCustomerId: url.searchParams.get("logged_in_customer_id"),
    };
};

export default function MyAppProxy() {
    const { shop, loggedInCustomerId } = useLoaderData();

    return <div>{`Hello world from ${loggedInCustomerId || "not-logged-in"} on ${shop}`}</div>;
}
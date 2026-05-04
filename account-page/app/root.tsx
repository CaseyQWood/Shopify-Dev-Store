import { Links, Outlet, Scripts, ScrollRestoration } from "react-router";

export default function App() {
  return (
    <>
      <Links />
      <Outlet />
      <ScrollRestoration />
      <Scripts />
    </>
  );
}

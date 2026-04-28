import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

startTransition(() => {
  hydrateRoot(
    document.getElementById("app-root")!,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>,
  );
});

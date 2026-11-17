import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { frameConsole } from "./device/frame-log";
import { routeTree } from "./routeTree.generated";
import { startTheme } from "./theme/store";

import "./styles/app.css";

Object.assign(window, { beastx: frameConsole });

startTheme();

const queryClient = new QueryClient();

const router = createRouter({
  context: { queryClient },
  defaultPreload: "intent",
  routeTree,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const root = document.querySelector("#root");

if (root) {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>
  );
}

import { TooltipProvider } from "@ethonline2026/ux-workflow";
import * as React from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app";
import "./styles.css";

const host = document.getElementById("root");
if (host === null) {
  // Fail loudly rather than mounting into nothing: a silently blank console is indistinguishable from
  // an API that returns nothing, and those need different fixes.
  throw new Error("The console has no #root to mount into.");
}

createRoot(host).render(
  <React.StrictMode>
    <TooltipProvider>
      <App />
    </TooltipProvider>
  </React.StrictMode>,
);

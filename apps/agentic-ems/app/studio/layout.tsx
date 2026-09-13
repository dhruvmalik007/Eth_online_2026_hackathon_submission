import type { Metadata } from "next";
// Reactor theme tokens, scoped to the /studio route only — the landing page
// does not load the Reactor SDK or its styles.
import "@reactor-team/ui/styles.css";

export const metadata: Metadata = {
  title: "Product Demo Studio — Agentic EMS",
  description:
    "FastH3 episode studio: compose the Agentic EMS pitch video as chained, continuous scenes.",
};

export default function StudioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

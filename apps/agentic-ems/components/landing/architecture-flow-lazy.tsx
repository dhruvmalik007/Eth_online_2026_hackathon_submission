"use client";

import dynamic from "next/dynamic";

/**
 * React Flow is ~100 kB of JS plus its own stylesheet, and the architecture
 * diagram sits well below the fold. Loading it dynamically keeps both out of the
 * landing page's initial bundle and out of its critical CSS path; it streams in
 * when the section scrolls into view.
 *
 * This wrapper exists because `dynamic(..., { ssr: false })` cannot be called
 * from a Server Component.
 */
const ArchitectureFlow = dynamic(
  () => import("./architecture-flow").then((m) => m.ArchitectureFlow),
  {
    ssr: false,
    loading: () => (
      <div
        className="h-[420px] w-full animate-pulse border border-edge-2 bg-panel-2"
        aria-hidden
      />
    ),
  },
);

export function ArchitectureFlowLazy() {
  return <ArchitectureFlow />;
}

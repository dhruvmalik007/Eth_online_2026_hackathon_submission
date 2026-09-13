import path from "node:path";
import type { NextConfig } from "next";

/**
 * Performance-focused config.
 *
 * `optimizePackageImports` is the biggest compile-time lever here: these are
 * large barrels (recharts, lucide, React Flow) or our own workspace component
 * library, and without it the compiler walks the whole package on every import.
 * Combined with Turbopack in dev, iteration time drops substantially.
 */
const nextConfig: NextConfig = {
  // Pin the tracing root: this repo has lockfiles in both the app and the
  // workspace root, so letting Next guess slows tracing and emits a warning.
  outputFileTracingRoot: path.join(__dirname, "../../"),

  experimental: {
    optimizePackageImports: [
      "recharts",
      "lucide-react",
      "@xyflow/react",
      "@ethonline2026/ux-workflow",
      "@radix-ui/react-dialog",
      "@radix-ui/react-tooltip",
      "@radix-ui/react-hover-card",
      "@radix-ui/react-scroll-area",
    ],
  },

  outputFileTracingIncludes: {
    "/api/demo/forecast": ["../../data/forecasts/**/*"],
    "/api/demo/market": ["../../data/defillama_metrics/**/*"],
  },
};

export default nextConfig;

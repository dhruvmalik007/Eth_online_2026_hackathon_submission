import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils.js";

/**
 * shadcn/ui Badge, re-themed to Terminal Noir.
 * Real shadcn pattern with semantic color variants.
 * Source: https://ui.shadcn.com/docs/components/badge
 */
export const badgeVariants = cva(
  "inline-flex items-center gap-1.5 border px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.14em] transition-colors",
  {
    variants: {
      variant: {
        default: "border-edge-2 bg-panel-2 text-fg-dim",
        secondary: "border-edge bg-panel-2 text-fg-dim",
        destructive: "border-down/50 bg-down/10 text-down",
        outline: "border-edge bg-transparent text-fg-dim",
        amber: "border-amber/50 bg-amber/10 text-amber",
        up: "border-up/50 bg-up/10 text-up",
        down: "border-down/50 bg-down/10 text-down",
        graph: "border-graph/50 bg-graph/10 text-graph-soft",
        oneinch: "border-oneinch/50 bg-oneinch/10 text-oneinch",
        uniswap: "border-uniswap/50 bg-uniswap/10 text-uniswap",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

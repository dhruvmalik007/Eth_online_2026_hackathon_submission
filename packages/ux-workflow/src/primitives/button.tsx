import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils.js";

/**
 * shadcn/ui Button, re-themed to Terminal Noir.
 * Uses the real shadcn pattern: cva + Slot for asChild support.
 * Source: https://ui.shadcn.com/docs/components/button
 */
export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-none text-sm font-medium transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 cursor-pointer",
  {
    variants: {
      variant: {
        default:
          "bg-amber text-on-amber font-semibold hover:opacity-90 active:translate-y-px shadow-[0_0_24px_-6px_var(--tk-amber)]",
        destructive: "bg-down text-white hover:bg-down/90",
        outline:
          "border border-edge-2 bg-transparent text-fg hover:border-amber/60 hover:text-amber",
        secondary: "bg-panel-2 text-fg hover:bg-panel-2/80",
        ghost: "text-fg-dim hover:bg-panel-2 hover:text-fg",
        link: "text-amber underline-offset-4 hover:underline",
        up: "border border-up/40 bg-up/10 text-up hover:bg-up/20",
        down: "border border-down/40 bg-down/10 text-down hover:bg-down/20",
        graph: "border border-graph/40 bg-graph/10 text-graph-soft hover:bg-graph/20",
      },
      size: {
        default: "h-10 px-5",
        sm: "h-8 px-3 text-xs",
        lg: "h-12 px-7 text-base",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

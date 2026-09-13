import * as React from "react";
import { cn } from "../lib/utils.js";

/**
 * shadcn/ui Input, re-themed to Terminal Noir.
 * Source: https://ui.shadcn.com/docs/components/input
 */
export interface InputProps extends React.ComponentProps<"input"> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-none border border-edge-2 bg-panel px-3 text-sm text-fg file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-fg placeholder:text-fg-faint focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

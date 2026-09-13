import * as React from "react";
import { cn } from "../lib/utils.js";

/**
 * shadcn/ui Textarea, re-themed to Terminal Noir.
 * Source: https://ui.shadcn.com/docs/components/textarea
 */
export interface TextareaProps extends React.ComponentProps<"textarea"> {}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[60px] w-full rounded-none border border-edge-2 bg-panel px-3 py-2 text-sm text-fg placeholder:text-fg-faint focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

"use client";

import * as React from "react";
import { cn } from "../lib/utils.js";

/**
 * TypingIndicator — animated dots showing AI is generating.
 */
export function TypingIndicator({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex items-center gap-1 px-3 py-2", className)} {...props}>
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-amber [animation-delay:0ms]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-amber [animation-delay:150ms]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-amber [animation-delay:300ms]" />
    </div>
  );
}

"use client";

import * as React from "react";
import { cn } from "../lib/utils.js";

/**
 * Conversation — auto-scrolling chat shell for AI interactions.
 * Wraps the Vercel AI SDK useChat pattern with Terminal Noir styling.
 */
export function Conversation({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [children]);

  return (
    <div
      ref={ref}
      className={cn("flex flex-col overflow-y-auto scroll-smooth", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function ConversationContent({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex flex-col gap-4 p-4", className)} {...props}>
      {children}
    </div>
  );
}

export function ConversationEmptyState({
  title,
  description,
  icon,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 py-16 text-center text-fg-dim",
        className,
      )}
      {...props}
    >
      {icon && <div className="text-fg-faint">{icon}</div>}
      {title && (
        <p className="font-mono text-sm font-semibold uppercase tracking-[0.18em]">
          {title}
        </p>
      )}
      {description && <p className="max-w-xs text-sm text-fg-faint">{description}</p>}
    </div>
  );
}

export function ConversationScrollButton({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "absolute bottom-4 right-4 z-10 flex h-8 w-8 items-center justify-center border border-edge-2 bg-panel text-fg-dim hover:text-amber",
        className,
      )}
      {...props}
    >
      ↓
    </button>
  );
}

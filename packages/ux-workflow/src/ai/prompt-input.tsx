"use client";

import * as React from "react";
import { cn } from "../lib/utils.js";

/**
 * PromptInput — auto-resize input + submit for AI chat.
 * Integrates with Vercel AI SDK useChat hook pattern.
 */
export interface PromptInputProps extends React.FormHTMLAttributes<HTMLFormElement> {
  isLoading?: boolean;
}

export function PromptInput({ className, children, isLoading, ...props }: PromptInputProps) {
  return (
    <form
      className={cn("flex items-end gap-2 border border-edge bg-panel p-2", className)}
      {...props}
    >
      {children}
    </form>
  );
}

export function PromptInputTextarea({
  className,
  placeholder = "Ask the desk agent...",
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }
  }, [(props as { value?: string }).value]);

  return (
    <textarea
      ref={ref}
      rows={1}
      placeholder={placeholder}
      className={cn(
        "flex-1 resize-none bg-transparent text-sm text-fg placeholder:text-fg-faint focus:outline-none",
        className,
      )}
      {...props}
    />
  );
}

export function PromptInputSubmit({
  className,
  children = "Send",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="submit"
      className={cn(
        "flex h-9 items-center justify-center bg-amber px-4 font-mono text-xs font-semibold uppercase tracking-[0.14em] text-on-amber hover:opacity-90 disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

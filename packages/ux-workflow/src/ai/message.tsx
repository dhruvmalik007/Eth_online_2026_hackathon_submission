"use client";

import * as React from "react";
import { cn } from "../lib/utils.js";

/**
 * Message — role-aligned bubble for AI conversations.
 * User messages right-aligned, assistant left-aligned.
 */
export type MessageRole = "user" | "assistant" | "system";

export interface MessageProps extends React.HTMLAttributes<HTMLDivElement> {
  from: MessageRole;
}

const roleStyles: Record<MessageRole, string> = {
  user: "ml-auto items-end",
  assistant: "mr-auto items-start",
  system: "mx-auto items-center",
};

export function Message({ from, className, children, ...props }: MessageProps) {
  return (
    <div
      className={cn("flex max-w-[85%] flex-col gap-1", roleStyles[from], className)}
      {...props}
    >
      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">
        {from}
      </span>
      {children}
    </div>
  );
}

export function MessageContent({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "border border-edge-2 bg-panel-2 p-3 text-sm leading-relaxed text-fg",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/**
 * MessageResponse — streaming markdown renderer for AI messages.
 * Renders markdown with syntax highlighting and Terminal Noir styling.
 */
export function MessageResponse({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "max-w-none text-sm leading-relaxed text-fg [&_a]:text-amber [&_a]:underline [&_code]:rounded [&_code]:bg-panel [&_code]:px-1 [&_code]:font-mono [&_code]:text-xs [&_code]:text-amber [&_pre]:border [&_pre]:border-edge-2 [&_pre]:bg-panel [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-xs",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

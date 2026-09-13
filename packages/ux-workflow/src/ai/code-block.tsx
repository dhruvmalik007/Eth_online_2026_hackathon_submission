import * as React from "react";
import { cn } from "../lib/utils.js";

/**
 * CodeBlock — syntax-highlighted code display.
 * Terminal Noir themed with copy button.
 */
export interface CodeBlockProps extends React.HTMLAttributes<HTMLDivElement> {
  language?: string;
  code: string;
}

export function CodeBlock({ className, language, code, ...props }: CodeBlockProps) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={cn("relative border border-edge-2 bg-panel font-mono text-xs", className)} {...props}>
      <div className="flex items-center justify-between border-b border-edge-2 px-3 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
          {language ?? "code"}
        </span>
        <button
          onClick={handleCopy}
          className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-dim hover:text-amber"
        >
          {copied ? "✓ copied" : "copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 leading-relaxed text-fg">
        <code>{code}</code>
      </pre>
    </div>
  );
}

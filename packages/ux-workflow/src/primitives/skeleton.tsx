import { cn } from "../lib/utils.js";

/**
 * shadcn/ui Skeleton — loading placeholder, Terminal Noir themed.
 * Source: https://ui.shadcn.com/docs/components/skeleton
 */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-none bg-panel-2", className)}
      {...props}
    />
  );
}

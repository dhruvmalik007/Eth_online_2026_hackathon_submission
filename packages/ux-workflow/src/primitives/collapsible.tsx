"use client";

import * as React from "react";
import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";
import { cn } from "../lib/utils.js";

/**
 * shadcn/ui Collapsible, re-themed to Terminal Noir.
 * Source: https://ui.shadcn.com/docs/components/collapsible
 *
 * Used for the nested "raw payload" disclosure inside an agent step, where a
 * full Accordion would be wrong — this is a single independent panel, not a
 * set of sibling headings.
 */
export function Collapsible({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Root>) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

export function CollapsibleTrigger({
  className,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Trigger>) {
  return (
    <CollapsiblePrimitive.Trigger
      data-slot="collapsible-trigger"
      className={cn("outline-none focus-visible:ring-1 focus-visible:ring-amber", className)}
      {...props}
    />
  );
}

export function CollapsibleContent({
  className,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Content>) {
  return (
    <CollapsiblePrimitive.Content
      data-slot="collapsible-content"
      className={cn(
        "overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down",
        className,
      )}
      {...props}
    />
  );
}

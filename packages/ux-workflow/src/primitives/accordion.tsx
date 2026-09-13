"use client";

import * as React from "react";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import { ChevronDown } from "lucide-react";
import { cn } from "../lib/utils.js";

/**
 * shadcn/ui Accordion, re-themed to Terminal Noir.
 * Source: https://ui.shadcn.com/docs/components/accordion
 *
 * Used for agent trace steps: Radix gives the WAI-ARIA accordion semantics
 * (aria-expanded / aria-controls, arrow-key navigation) that a hand-rolled
 * div+useState cannot, which is the whole reason this primitive exists here.
 */
export function Accordion({
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Root>) {
  return <AccordionPrimitive.Root data-slot="accordion" {...props} />;
}

export function AccordionItem({
  className,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Item>) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn("border-b border-edge last:border-b-0", className)}
      {...props}
    />
  );
}

export function AccordionTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Trigger>) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          "group/trigger flex flex-1 items-start justify-between gap-3 py-2.5 text-left outline-none transition-colors",
          "hover:text-amber focus-visible:ring-1 focus-visible:ring-amber disabled:pointer-events-none disabled:opacity-50",
          "[&[data-state=open]>svg]:rotate-180",
          className,
        )}
        {...props}
      >
        {children}
        <ChevronDown
          className="pointer-events-none mt-0.5 size-3.5 shrink-0 text-fg-faint transition-transform duration-200 group-hover/trigger:text-amber"
          aria-hidden
        />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  );
}

export function AccordionContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Content>) {
  return (
    <AccordionPrimitive.Content
      data-slot="accordion-content"
      className={cn(
        "overflow-hidden data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down",
        className,
      )}
      {...props}
    >
      <div className="pb-3">{children}</div>
    </AccordionPrimitive.Content>
  );
}

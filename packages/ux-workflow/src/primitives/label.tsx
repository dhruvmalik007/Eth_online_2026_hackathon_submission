"use client";

import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils.js";

/**
 * shadcn/ui Label, re-themed to Terminal Noir.
 * Source: https://ui.shadcn.com/docs/components/label
 */
export const labelVariants = cva(
  "text-sm font-medium leading-none text-fg peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
);

export const Label = React.forwardRef<
  React.ComponentRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> &
    VariantProps<typeof labelVariants>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(labelVariants(), className)}
    {...props}
  />
));
Label.displayName = LabelPrimitive.Root.displayName;

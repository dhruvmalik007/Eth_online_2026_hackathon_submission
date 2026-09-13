import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind CSS classes with clsx + tailwind-merge.
 * Usage: cn("text-amber", condition && "font-bold")
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

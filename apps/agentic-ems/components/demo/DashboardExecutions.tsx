"use client";

import { useDemo } from "@/lib/demo/state";
import { RecentExecutions } from "./RecentExecutions";

/**
 * Thin reader so `RecentExecutions` stays presentational and the dashboard can
 * mount it inside a DemoProvider without the component knowing about context.
 */
export function DashboardExecutions() {
  const { state } = useDemo();
  return <RecentExecutions records={state.executions ?? []} />;
}

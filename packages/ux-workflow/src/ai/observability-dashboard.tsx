"use client";

import * as React from "react";
import { cn } from "../lib/utils.js";
import { Card, CardHeader, CardTitle, CardContent } from "../primitives/card.js";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../primitives/tabs.js";
import { TraceViewer } from "./trace-viewer.js";
import { MetricsTimeline } from "./metrics-timeline.js";
import { AlertFeed } from "./alert-feed.js";

/**
 * ObservabilityDashboard — unified view combining LangSmith traces + TimescaleDB metrics.
 *
 * Tabbed dashboard:
 * - Traces: agent decisions, tool calls, reasoning (LangSmith)
 * - Metrics: loss, yield, volatility timeseries (TimescaleDB)
 * - Alerts: training complete, metric threshold breach, consensus conflict
 */

export interface ObservabilityDashboardProps extends React.ComponentProps<typeof Card> {
  traces?: Array<{
    id: string;
    timestamp: string;
    type: "tool_call" | "reasoning" | "decision";
    content: string;
    duration?: number;
    tokenCount?: number;
  }>;
  metrics?: Array<{
    name: string;
    timestamps: number[];
    values: number[];
    unit?: string;
  }>;
  alerts?: Array<{
    id: string;
    severity: "info" | "warning" | "error";
    message: string;
    timestamp: string;
  }>;
}

export function ObservabilityDashboard({
  className,
  traces = [],
  metrics = [],
  alerts = [],
  ...props
}: ObservabilityDashboardProps) {
  return (
    <Card className={cn("", className)} {...props}>
      <CardHeader>
        <CardTitle>Observability Dashboard</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="traces" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="traces">Traces ({traces.length})</TabsTrigger>
            <TabsTrigger value="metrics">Metrics ({metrics.length})</TabsTrigger>
            <TabsTrigger value="alerts">Alerts ({alerts.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="traces" className="mt-4">
            <TraceViewer traces={traces} />
          </TabsContent>
          <TabsContent value="metrics" className="mt-4">
            <MetricsTimeline series={metrics} />
          </TabsContent>
          <TabsContent value="alerts" className="mt-4">
            <AlertFeed alerts={alerts} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

"use client";

import * as React from "react";
import { cn } from "../lib/utils.js";
import { Card, CardHeader, CardTitle, CardContent } from "../primitives/card.js";
import { Badge } from "../primitives/badge.js";
import { Button } from "../primitives/button.js";

/**
 * ModelRegistry — browse fine-tuned models, compare versions, deploy.
 *
 * Connects to HuggingFace Hub model list via the hf-llm-trainer black box.
 */

export interface RegisteredModel {
  id: string;
  hubId: string;
  baseModel: string;
  method: string;
  status: "ready" | "deployed" | "archived";
  createdAt: string;
  metrics?: { accuracy?: number; reasoning?: number };
}

export interface ModelRegistryProps extends React.ComponentProps<typeof Card> {
  models: RegisteredModel[];
  onDeploy?: (modelId: string) => void;
  onCompare?: (modelId: string) => void;
  onArchive?: (modelId: string) => void;
}

export function ModelRegistry({
  className,
  models,
  onDeploy,
  onCompare,
  onArchive,
  ...props
}: ModelRegistryProps) {
  return (
    <Card className={cn("", className)} {...props}>
      <CardHeader>
        <CardTitle>Model Registry</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {models.map((m) => (
            <div
              key={m.id}
              className="flex flex-col gap-2 border border-edge-2 bg-panel-2 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-center gap-3">
                <div>
                  <p className="font-mono text-xs text-fg">{m.hubId}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <Badge variant="outline">{m.method}</Badge>
                    <Badge
                      variant={
                        m.status === "deployed"
                          ? "up"
                          : m.status === "ready"
                            ? "amber"
                            : "default"
                      }
                    >
                      {m.status}
                    </Badge>
                    <span className="font-mono text-[10px] text-fg-faint">{m.createdAt}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {m.metrics?.accuracy !== undefined && (
                  <span className="font-mono text-[10px] text-fg-dim">
                    acc: {(m.metrics.accuracy * 100).toFixed(0)}%
                  </span>
                )}
                {m.status === "ready" && onDeploy && (
                  <Button size="sm" onClick={() => onDeploy(m.id)}>
                    Deploy
                  </Button>
                )}
                {onCompare && (
                  <Button size="sm" variant="outline" onClick={() => onCompare(m.id)}>
                    Compare
                  </Button>
                )}
                {onArchive && m.status !== "archived" && (
                  <Button size="sm" variant="ghost" onClick={() => onArchive(m.id)}>
                    Archive
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

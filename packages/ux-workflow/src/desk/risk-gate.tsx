"use client";

import * as React from "react";
import { cn } from "../lib/utils.js";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "../primitives/card.js";
import { Button } from "../primitives/button.js";
import { Badge } from "../primitives/badge.js";
import { Separator } from "../primitives/separator.js";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../primitives/table.js";

/**
 * RiskGate — HITL compliance approval surface (the centerpiece).
 *
 * Per the observation report §4.3, a production approval screen must show:
 * - What the agent observed + data sources used
 * - What action is proposed + why
 * - Which rule/threshold triggered it
 * - Current risk limits + projected impact
 * - Stress-test scenarios
 * - Four-eyes enforcement (second approver for large trades)
 * - Audit trail (proposal snapshot hash + timestamp)
 *
 * Built on shadcn/ui Card + Table + Button + Badge.
 */

export interface RiskMetric {
  label: string;
  current: number;
  limit: number;
  unit: string;
  status: "pass" | "warn" | "fail";
}

export interface ScenarioResult {
  name: string;
  apy: number;
  passed: boolean;
}

export interface DataSource {
  name: string;
  block: string;
  timestamp?: string;
}

export interface RiskGateProps extends React.ComponentProps<typeof Card> {
  proposalId: string;
  sessionDate: string;
  sessionPhase: string;
  traderId: string;
  thesis: string;
  proposedAllocation: { alpha: number; beta: number; gamma: number };
  notionalUsd: number;
  riskMetrics: RiskMetric[];
  scenarios: ScenarioResult[];
  dataSources: DataSource[];
  requiresFourEyes?: boolean;
  onApprove?: (approverId?: string) => void;
  onOverride?: (overrides: Partial<{ alpha: number; beta: number; gamma: number }>) => void;
  onReject?: () => void;
}

export function RiskGate({
  className,
  proposalId,
  sessionDate,
  sessionPhase,
  traderId,
  thesis,
  proposedAllocation,
  notionalUsd,
  riskMetrics,
  scenarios,
  dataSources,
  requiresFourEyes = false,
  onApprove,
  onOverride,
  onReject,
  ...props
}: RiskGateProps) {
  const [approverId, setApproverId] = React.useState("");
  const [overrides] = React.useState<Partial<{ alpha: number; beta: number; gamma: number }>>({});

  const snapshotHash = React.useMemo(() => {
    const str = `${proposalId}-${sessionDate}-${JSON.stringify(proposedAllocation)}-${Date.now()}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return "0x" + Math.abs(hash).toString(16).padStart(8, "0") + "…" + Math.abs(hash >> 8).toString(16).slice(-4);
  }, [proposalId, sessionDate, proposedAllocation]);

  const formatMoney = (n: number) =>
    n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(0)}`;

  return (
    <Card className={cn("border-2 border-amber/30", className)} {...props}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Compliance Review</CardTitle>
            <CardDescription>
              Proposal #{proposalId} · {sessionDate} ({sessionPhase})
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="amber">HITL</Badge>
            <span className="font-mono text-[10px] text-fg-faint">{traderId}</span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Thesis */}
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-fg-dim">Thesis</p>
          <p className="mt-1 font-mono text-sm leading-relaxed text-fg">{thesis}</p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Proposed Allocation */}
          <div>
            <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-dim">
              Proposed Allocation
            </p>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-fg">α (LST)</span>
                <span className="font-mono text-xs font-semibold tabular-nums text-fg">
                  {(proposedAllocation.alpha * 100).toFixed(1)}%
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-fg">β (sweep)</span>
                <span className="font-mono text-xs font-semibold tabular-nums text-fg">
                  {(proposedAllocation.beta * 100).toFixed(1)}%
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-fg">γ (fee)</span>
                <span className="font-mono text-xs font-semibold tabular-nums text-fg">
                  {(proposedAllocation.gamma * 100).toFixed(2)}%
                </span>
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-semibold text-fg">Notional</span>
                <span className="font-mono text-xs font-semibold tabular-nums text-fg">
                  {formatMoney(notionalUsd)}
                </span>
              </div>
            </div>
          </div>

          {/* Risk Metrics */}
          <div>
            <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-dim">
              Risk Impact
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Metric</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {riskMetrics.map((m) => (
                  <TableRow key={m.label}>
                    <TableCell className="font-mono text-xs">{m.label}</TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {m.current.toFixed(2)}{m.unit} / {m.limit.toFixed(2)}{m.unit}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge
                        variant={
                          m.status === "pass" ? "up" : m.status === "warn" ? "amber" : "down"
                        }
                      >
                        {m.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Scenarios */}
        <div>
          <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-dim">
            Stress Scenarios
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {scenarios.map((s) => (
              <div
                key={s.name}
                className={cn(
                  "border px-3 py-2",
                  s.passed ? "border-up/40 bg-up/5" : "border-down/40 bg-down/5",
                )}
              >
                <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-fg-dim">
                  {s.name}
                </p>
                <p className={cn("font-mono text-sm font-semibold", s.passed ? "text-up" : "text-down")}>
                  {s.apy.toFixed(2)}%
                </p>
                <Badge variant={s.passed ? "up" : "down"}>{s.passed ? "PASS" : "FAIL"}</Badge>
              </div>
            ))}
          </div>
        </div>

        {/* Data Sources */}
        <div>
          <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-dim">
            Data Provenance
          </p>
          <div className="flex flex-wrap gap-2">
            {dataSources.map((ds, i) => (
              <div key={i} className="border border-edge-2 bg-panel-2 px-2 py-1 font-mono text-[10px] text-fg-dim">
                {ds.name} <span className="text-fg-faint">@ blk {ds.block}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Four Eyes */}
        {requiresFourEyes && (
          <div className="border border-amber/40 bg-amber/5 p-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-amber">
              ⚠ Four-Eyes Required — Notional &gt; $1M
            </p>
            <div className="mt-2 flex gap-2">
              <input
                type="text"
                placeholder="Approver ID"
                value={approverId}
                onChange={(e) => setApproverId(e.target.value)}
                className="flex-1 border border-edge-2 bg-panel px-2 py-1 font-mono text-xs text-fg"
              />
            </div>
          </div>
        )}
      </CardContent>

      <CardFooter className="flex flex-col gap-3 border-t border-edge-2 pt-4 sm:flex-row sm:justify-between">
        <p className="font-mono text-[9px] text-fg-faint">
          Snapshot: {snapshotHash} @ {new Date().toISOString().slice(0, 19)}Z
        </p>
        <div className="flex gap-2">
          {onReject && (
            <Button variant="outline" onClick={onReject}>
              Reject
            </Button>
          )}
          {onOverride && (
            <Button
              variant="secondary"
              onClick={() => onOverride(overrides)}
            >
              Override
            </Button>
          )}
          {onApprove && (
            <Button
              onClick={() => onApprove(requiresFourEyes ? approverId : undefined)}
              disabled={requiresFourEyes && !approverId}
            >
              Approve
            </Button>
          )}
        </div>
      </CardFooter>
    </Card>
  );
}

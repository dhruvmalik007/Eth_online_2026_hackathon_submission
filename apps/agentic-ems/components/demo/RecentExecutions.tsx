"use client";

import * as React from "react";
import { ExternalLink } from "lucide-react";
import { StepPill } from "@ethonline2026/ux-workflow";
import type { ExecutionRecord } from "@/lib/execution/types";
import { chainLabel } from "@/lib/execution/chains";

/**
 * RecentExecutions — the durable transaction record.
 *
 * Presentational on purpose: it takes `records` rather than reading context, so
 * the dashboard can render it without depending on the demo state provider.
 * Every hash is a real link out (the app had none before); cross-chain legs show
 * source and destination separately.
 */

export interface RecentExecutionsProps {
  records: ExecutionRecord[];
}

function timeAgo(createdAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - createdAt) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

export function RecentExecutions({ records }: RecentExecutionsProps) {
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);

  if (records.length === 0) {
    return (
      <section className="border border-edge-2 bg-panel lg:col-span-12">
        <div className="border-b border-edge px-3 py-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">
            Recent executions
          </p>
        </div>
        <div className="px-4 py-6">
          <p className="text-sm text-fg-dim">No executions recorded yet.</p>
          <p className="mt-1 text-xs leading-relaxed text-fg-faint">
            Describe a multi-leg allocation in the desk chat — for example{" "}
            <span className="font-mono text-fg-dim">
              &ldquo;invest $100,000: $50k Morpho on Base, $35k Uniswap v4 on Optimism, $15k
              Polymarket on Polygon&rdquo;
            </span>{" "}
            — review the clear-signed batch, and the settled run appears here with its transaction
            links.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="border border-edge-2 bg-panel lg:col-span-12">
      <div className="flex items-center justify-between border-b border-edge px-3 py-2">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">
          Recent executions
        </p>
        <p className="font-mono text-[9px] text-fg-faint">
          {records.length} run{records.length === 1 ? "" : "s"} · simulated adapter
        </p>
      </div>

      <div className="grid gap-px bg-edge md:grid-cols-2 xl:grid-cols-3">
        {records.slice(0, 6).map((record) => (
          <article key={record.id} className="bg-panel p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-mono text-[10px] tabular-nums text-fg-faint">{record.id}</p>
                <p className="mt-0.5 font-mono text-[10px] text-fg-faint">
                  {timeAgo(record.createdAt, now)}
                </p>
              </div>
              <StepPill state={record.status === "complete" ? "confirmed" : "failed"} />
            </div>

            <div className="mt-2.5 space-y-1">
              {record.legs.map((leg) => (
                <div key={leg.id} className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px] text-fg-dim">
                    {leg.label} · {chainLabel(leg.chain)}
                  </span>
                  <span className="font-mono text-[10px] tabular-nums text-fg">
                    ${leg.deployedUsd.toLocaleString("en-US")}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-2.5 grid grid-cols-3 gap-px bg-edge">
              <div className="bg-panel-2 px-2 py-1.5">
                <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-fg-faint">Cost</p>
                <p className="font-mono text-[11px] tabular-nums text-amber">
                  ${record.costUsd.toFixed(2)}
                </p>
              </div>
              <div className="bg-panel-2 px-2 py-1.5">
                <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-fg-faint">Steps</p>
                <p className="font-mono text-[11px] tabular-nums text-fg-dim">
                  {record.confirmedCount}/{record.stepCount}
                </p>
              </div>
              <div className="bg-panel-2 px-2 py-1.5">
                <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-fg-faint">
                  Notional
                </p>
                <p className="font-mono text-[11px] tabular-nums text-fg-dim">
                  ${Math.round(record.notionalUsd / 1000)}k
                </p>
              </div>
            </div>

            {record.links.length > 0 ? (
              <ul className="mt-2.5 space-y-1">
                {record.links.map((link) => (
                  <li key={`${record.id}-${link.label}-${link.hash ?? ""}`}>
                    {link.url ? (
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 font-mono text-[10px] text-fg-dim hover:text-amber"
                      >
                        {link.label}
                        <span className="text-fg-faint">
                          {link.hash ? `${link.hash.slice(0, 8)}…${link.hash.slice(-6)}` : ""}
                        </span>
                        <ExternalLink className="size-3" aria-hidden />
                      </a>
                    ) : (
                      <span className="font-mono text-[10px] text-fg-faint">{link.label}</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

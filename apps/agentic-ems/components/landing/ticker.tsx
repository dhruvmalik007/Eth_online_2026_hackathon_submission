import { cn } from "@/lib/utils";
import type { TapeRow } from "@/lib/live/subgraph-stats";

/**
 * The tape, fed by the registry rather than by prose.
 *
 * The previous version carried Uniswap v4 cumulative volumes and Aave block heights as literals
 * under a comment claiming they were "verified against live gateway queries". They were not —
 * nothing fetched them, and a number nobody can check is a claim, not data. These rows are counted
 * from the deployment registry and its endpoint probe, and each one names what it excluded.
 *
 * When there is nothing to show the tape renders nothing. An empty tape is the honest outcome of a
 * failed read; a plausible number is not.
 */
export function Ticker({ rows }: { rows: readonly TapeRow[] }) {
  if (rows.length === 0) return null;
  const tape = [...rows, ...rows];

  return (
    <div className="ticker-mask overflow-hidden border-b border-edge bg-panel">
      <div className={cn("flex w-max items-center gap-10 py-2 animate-marquee")} aria-hidden>
        {tape.map((t, i) => (
          <span key={i} className="flex items-baseline gap-2 whitespace-nowrap font-mono text-[11px]">
            <span className="text-fg-faint">{t.label}</span>
            <span className="font-semibold text-fg">{t.value}</span>
            {t.delta ? (
              <span className={cn(t.dir === "up" && "text-up", t.dir === "down" && "text-down")}>
                {t.delta}
              </span>
            ) : null}
            <span className="text-edge-2">│</span>
          </span>
        ))}
      </div>
    </div>
  );
}

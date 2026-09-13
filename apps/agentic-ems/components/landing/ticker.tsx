import { cn } from "@/lib/utils";

type Tick = { label: string; value: string; delta?: string; dir?: "up" | "down" };

/**
 * Real snapshot values — packages/the-graph/PHASE1_TEST_RESULTS.md,
 * verified against live gateway queries on 2026-09-07 (block 25,925,399).
 * Nothing on this tape is fabricated.
 */
const TICKS: Tick[] = [
  { label: "V4 USDC/USDT CUM", value: "$505.5B", delta: "+953K TX", dir: "up" },
  { label: "V4 USDC/WETH HOOK", value: "$1.93B", delta: "DYN FEE", dir: "up" },
  { label: "V4 USDE/USDT HOOK", value: "$1.59B", delta: "HOOK 0x4440…", dir: "up" },
  { label: "V4 ETH/USDT CUM", value: "$13.99B", delta: "1.48M TX", dir: "up" },
  { label: "V4 ETH/USDC CUM", value: "$11.94B", delta: "1.44M TX", dir: "up" },
  { label: "V4 ETH/USDC 24H", value: "$2.35M", delta: "+FEES $1.2K", dir: "up" },
  { label: "AAVE V3 BLOCK", value: "25,925,399", delta: "ETH", dir: "up" },
  { label: "AAVE V3 BLOCK", value: "502,674,124", delta: "ARB", dir: "up" },
  { label: "AAVE V3 BLOCK", value: "156,592,194", delta: "OPT", dir: "up" },
  { label: "SNAPSHOT", value: "2026-09-07", delta: "GATEWAY LIVE", dir: "up" },
];

export function Ticker() {
  const tape = [...TICKS, ...TICKS];
  return (
    <div className="ticker-mask overflow-hidden border-b border-edge bg-panel">
      <div
        className={cn(
          "flex w-max items-center gap-10 py-2 animate-marquee",
        )}
        aria-hidden
      >
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

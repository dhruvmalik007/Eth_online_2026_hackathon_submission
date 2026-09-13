import { ArrowDownToLine, Blocks, CheckCircle2, Database, Sigma } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Dict } from "@/lib/i18n";

const ENDPOINTS = [
  {
    name: "Aave V3 — Ethereum",
    id: "Cd2gED…LNRcL87g",
    block: "25,925,399",
    what: "reserves · liquidityRate · variableBorrowRate · utilization",
    sample: "USDC 6.8% supply · 1INCH $1.67M TVL",
  },
  {
    name: "Aave V3 — Arbitrum",
    id: "DLuE98…bAEqMfy3B",
    block: "502,674,124",
    what: "same standardized schema, second chain",
    sample: "FRAX $128K · WBTC · ezETH",
  },
  {
    name: "Aave V3 — Optimism",
    id: "DSfLz8…LSXAfvb",
    block: "156,592,194",
    what: "same query, zero changes — that is the point",
    sample: "USDC 3.5% borrow · LINK · wstETH",
  },
  {
    name: "Uniswap V4 — PoolManager",
    id: "DiYPVd…2rkLb3G",
    block: "25,925,399",
    what: "pools · hooks · feeTier · volumeUSD · hour series",
    sample: "131,148 pools · $654B volume · 37.7M tx",
  },
  {
    name: "Polymarket — Activity",
    id: "Bx1W4S…2DiBp",
    block: "93,385,421",
    what: "conditions · fixedProductMarketMakers · redemptions",
    sample: "$29.4M single redemption payout",
  },
];

const PIPELINE_ICONS = [Database, Sigma, Blocks, ArrowDownToLine];

export function LiveData({ t }: { t: Dict }) {

  return (
    <section id="live" className="border-b border-edge py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-5">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-amber">
          {t.live.kicker}
        </p>
        <h2 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight md:text-4xl">
          {t.live.h2a}
          <span className="text-fg-dim">{t.live.h2b}</span>
        </h2>
        <p className="mt-5 max-w-3xl text-base leading-relaxed text-fg-dim">{t.live.lead}</p>

        <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {ENDPOINTS.map((e) => (
            <Card key={e.name} className="hover:border-edge-2">
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="text-fg">{e.name}</CardTitle>
                <Badge variant="up">
                  <CheckCircle2 className="size-3" />
                  {t.live.healthy}
                </Badge>
              </CardHeader>
              <CardContent>
                <p className="font-mono text-xs text-fg-faint">
                  id {e.id} · block <span className="text-amber">{e.block}</span>
                </p>
                <p className="mt-2 text-xs leading-relaxed text-fg-dim">{e.what}</p>
                <p className="mt-2 border-l-2 border-edge-2 pl-2 font-mono text-[11px] text-fg-faint">
                  {e.sample}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="mt-12 grid gap-px border border-edge bg-edge md:grid-cols-2">
          {t.live.pipeline.map((p, i) => {
            const Icon = PIPELINE_ICONS[i] ?? Database;
            return (
              <div key={p.title} className="bg-ink p-6">
                <div className="flex items-center gap-3">
                  <Icon className="size-5 text-amber" />
                  <h3 className="font-semibold">{p.title}</h3>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-fg-dim">{p.body}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

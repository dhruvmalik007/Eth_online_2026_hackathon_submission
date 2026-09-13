import { ArrowLeftRight, Banknote, Gauge, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Dict } from "@/lib/i18n";

const HOOK_ICONS = [Zap, Banknote, ArrowLeftRight, Gauge];

export function V4Strategies({ t }: { t: Dict }) {

  return (
    <section id="v4" className="border-b border-edge py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-amber">
            {t.v4.kicker}
          </p>
          <Badge variant="uniswap">Uniswap Foundation · $3,000</Badge>
          <Badge variant="oneinch">1inch Aqua · $5,000</Badge>
        </div>
        <h2 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight md:text-4xl">
          {t.v4.h2a}
          <span className="text-fg-dim">{t.v4.h2b}</span>
        </h2>
        <p className="mt-5 max-w-3xl text-base leading-relaxed text-fg-dim">{t.v4.lead}</p>

        <div className="mt-12 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          {/* Math terminal — stays dark in both themes via .term */}
          <div className="term">
            <div className="border border-edge-2">
              <div className="flex items-center justify-between border-b border-edge px-4 py-2.5">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-fg-faint">
                  {t.v4.termTitle}
                </p>
                <p className="font-mono text-[10px] text-fg-faint">{t.v4.termAssertions}</p>
              </div>
              <div className="divide-y divide-edge">
                {t.v4.formulas.map((f) => (
                  <div key={f.name} className="px-5 py-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-mono text-sm font-semibold text-amber">{f.formula}</p>
                      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">
                        {f.name}
                      </p>
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-fg-dim">{f.note}</p>
                  </div>
                ))}
              </div>
              <div className="border-t border-edge px-5 py-3 font-mono text-[11px] leading-relaxed text-fg-faint">
                <span className="text-up">{t.v4.examplePrefix}</span> — {t.v4.exampleBody}
              </div>
            </div>
          </div>

          {/* Dual-hook flow */}
          <div className="space-y-4">
            {t.v4.hooks.map((h, i) => {
              const Icon = HOOK_ICONS[i] ?? Zap;
              return (
                <Card key={h.title}>
                  <CardHeader className="flex-row items-center gap-3 space-y-0 pb-3">
                    <span className="flex size-8 shrink-0 items-center justify-center border border-amber/40 bg-amber/10 font-mono text-xs text-amber">
                      {i + 1}
                    </span>
                    <CardTitle className="text-[12px] normal-case tracking-normal text-fg">
                      {h.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <p className="text-sm leading-relaxed text-fg-dim">{h.body}</p>
                  </CardContent>
                </Card>
              );
            })}
            <p className="font-mono text-[11px] leading-relaxed text-fg-faint">{t.v4.aquaNote}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

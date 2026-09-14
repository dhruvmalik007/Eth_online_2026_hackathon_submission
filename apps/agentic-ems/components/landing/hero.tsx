import { ArrowRight, FileText } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Dict } from "@/lib/i18n";
import type { LandingStats } from "@/lib/live/subgraph-stats";

const BOOT_TONE = {
  dim: "text-fg-dim",
  ok: "text-up",
  warn: "text-amber",
} as const;

const METRIC_TONE = {
  up: "text-up",
  down: "text-down",
  fg: "text-fg",
} as const;

/**
 * The hero, with its numbers passed in.
 *
 * Nothing numeric is written in this file: the tiles, the boot log and the terminal readout all come
 * from {@link LandingStats}, which counts them from the subgraph registry. They used to be literals
 * here — `5` subgraphs, `3` chains, `7` quant tools, `12.1%` net APY — and every one of them was
 * wrong in the direction of looking better than the system is.
 */
export function Hero({ t, stats }: { t: Dict; stats: LandingStats }) {
  const labels = [t.hero.stat1k, t.hero.stat2k, t.hero.stat3k];

  return (
    <section id="top" className="relative overflow-hidden border-b border-edge">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,transparent_20%,var(--tk-ink)_78%)]"
      />
      <div className="relative mx-auto max-w-7xl px-5 pb-20 pt-16 md:pt-24">
        <div className="grid items-start gap-12 lg:grid-cols-[1.1fr_1fr]">
          {/* Narrative */}
          <div>
            <div className="mb-5 flex flex-wrap items-center gap-2">
              <Badge variant="amber">{t.hero.badgeEvent}</Badge>
              <Badge variant="graph">{t.hero.badgeGraph}</Badge>
              <Badge variant="oneinch">{t.hero.badgeOneinch}</Badge>
              <Badge variant="uniswap">{t.hero.badgeUniswap}</Badge>
            </div>
            <h1 className="text-4xl font-semibold leading-[1.05] tracking-tight md:text-6xl">
              {t.hero.h1a}
              <br />
              <span className="text-amber">{t.hero.h1b}</span>
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-fg-dim md:text-lg">
              {t.hero.leadA}
              <span className="text-fg">{t.hero.leadB}</span>
              {t.hero.leadC}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a href="/demo" className={buttonVariants({ size: "lg" })}>
                Product Demo
                <ArrowRight className="size-4" />
              </a>
              <a href="#architecture" className={buttonVariants({ variant: "outline", size: "lg" })}>
                {t.hero.ctaArchitecture}
                <ArrowRight className="size-4" />
              </a>
              <a href="#prizes" className={buttonVariants({ variant: "outline", size: "lg" })}>
                <FileText className="size-4" />
                {t.hero.ctaPrizes}
              </a>
            </div>

            <dl className="mt-12 grid max-w-lg grid-cols-3 gap-px border border-edge bg-edge">
              {stats.stats.map((s, i) => (
                <div key={labels[i]} className="bg-panel px-4 py-3">
                  <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">
                    {labels[i]}
                  </dt>
                  <dd className="mt-1 font-mono text-2xl font-semibold text-amber">{s.v}</dd>
                  <dd className="font-mono text-[10px] text-fg-faint">{s.s}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* Terminal — stays dark in both themes via .term */}
          <div className="term relative">
            <div className="border border-edge-2 shadow-[0_0_80px_-20px] shadow-amber/20">
              <div className="flex items-center justify-between border-b border-edge px-4 py-2.5">
                <div className="flex items-center gap-1.5" aria-hidden>
                  <span className="size-2.5 border border-edge-2 bg-panel-2" />
                  <span className="size-2.5 border border-edge-2 bg-panel-2" />
                  <span className="size-2.5 border border-edge-2 bg-amber/60" />
                </div>
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-fg-faint">
                  {t.hero.termTitle}
                </p>
                <p className="font-mono text-[10px] text-fg-faint">tty0</p>
              </div>
              <div className="space-y-2 p-5 font-mono text-[13px] leading-relaxed">
                {stats.bootLines.map((l, i) => (
                  <p
                    key={i}
                    className={BOOT_TONE[l.tone]}
                    style={{
                      animation: "hero-line 0.4s ease-out both",
                      animationDelay: `${0.35 + i * 0.45}s`,
                    }}
                  >
                    {l.t}
                  </p>
                ))}
                <p className="text-amber">
                  <span className="inline-block h-4 w-2 translate-y-0.5 animate-blink bg-amber" />
                </p>
              </div>
              <div className="grid grid-cols-2 border-t border-edge font-mono text-xs md:grid-cols-4">
                {stats.terminal.map((s) => (
                  <div key={s.k} className="border-r border-edge px-4 py-3 last:border-r-0">
                    <p className="text-[10px] uppercase tracking-[0.16em] text-fg-faint">{s.k}</p>
                    <p className={`mt-0.5 text-lg font-semibold ${METRIC_TONE[s.tone]}`}>{s.v}</p>
                  </div>
                ))}
              </div>
            </div>
            <p className="mt-3 text-right font-mono text-[10px] text-fg-faint">
              {t.hero.metricsNote}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

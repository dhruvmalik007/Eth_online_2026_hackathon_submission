import { ArrowDownToLine, Blocks, CircleCheck, Database, Sigma } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Dict } from "@/lib/i18n";
import type { LandingStats } from "@/lib/live/subgraph-stats";

const PIPELINE_ICONS = [Database, Sigma, Blocks, ArrowDownToLine];

const TONE_CLASS = {
  up: "text-up",
  down: "text-down",
  fg: "text-fg",
} as const;

/**
 * The Live Data section, and the correction that matters most on this page.
 *
 * The previous version listed five endpoints with hand-written block heights, a hand-written sample
 * row each, and a green "healthy" badge on all five — including the ones the probe had found dead.
 * It described the system as it was hoped to be, in the one place a reader cannot check.
 *
 * Each card is now one protocol as the probe actually found it: the networks it was reached on, how
 * many answered, how many hit a schema difference, how many did not answer, and the block one
 * endpoint reported. The badge counts what answered instead of asserting "healthy", because those
 * are different claims and only one of them is supported.
 */
export function LiveData({ t, stats }: { t: Dict; stats: LandingStats }) {
  return (
    <section id="live" className="border-b border-edge py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-5">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-amber">{t.live.kicker}</p>
        <h2 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight md:text-4xl">
          {t.live.h2a}
          <span className="text-fg-dim">{t.live.h2b}</span>
        </h2>
        <p className="mt-5 max-w-3xl text-base leading-relaxed text-fg-dim">{t.live.lead}</p>

        <dl className="mt-10 grid grid-cols-2 gap-px border border-edge bg-edge md:grid-cols-4">
          {stats.probeSummary.map((s) => (
            <div key={s.k} className="bg-panel px-4 py-3">
              <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">{s.k}</dt>
              <dd className={`mt-1 font-mono text-2xl font-semibold ${TONE_CLASS[s.tone]}`}>{s.v}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {stats.sources.map((s) => (
            <Card key={s.protocol} className="hover:border-edge-2">
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="text-fg">
                  {s.protocol}
                  <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                    {s.category}
                  </span>
                </CardTitle>
                <Badge variant={s.tone === "up" ? "up" : "amber"}>
                  <CircleCheck className="size-3" />
                  {s.answering} {t.live.answering}
                </Badge>
              </CardHeader>
              <CardContent>
                <p className="font-mono text-xs text-fg-faint">{s.networks.join(" · ")}</p>
                <p className="mt-2 break-all border-l-2 border-edge-2 pl-2 font-mono text-[11px] text-fg-faint">
                  {s.detail}
                </p>
                <p className="mt-2 font-mono text-[10px] text-fg-faint">
                  {s.answering} answering · {s.partial} partial · {s.dead} dead
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

import { Landmark, LineChart, Scale, Waves } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Dict } from "@/lib/i18n";

const DESK_ICONS = [Landmark, LineChart, Waves, Scale];

export function Thesis({ t }: { t: Dict }) {

  return (
    <section id="thesis" className="border-b border-edge py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-5">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-amber">
          {t.thesis.kicker}
        </p>
        <h2 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight md:text-4xl">
          {t.thesis.h2a}
          <span className="text-fg-dim">{t.thesis.h2b}</span>
        </h2>
        <p className="mt-5 max-w-3xl text-base leading-relaxed text-fg-dim">
          {t.thesis.lead}
        </p>

        <div className="mt-12 grid gap-px border border-edge bg-edge md:grid-cols-2">
          {t.thesis.desks.map((d, i) => {
            const Icon = DESK_ICONS[i] ?? Landmark;
            return (
              <div key={d.desk} className="group bg-panel p-6 transition-colors hover:bg-panel-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Icon className="size-5 text-amber" />
                    <h3 className="font-mono text-sm font-semibold uppercase tracking-[0.18em]">
                      {d.desk}
                    </h3>
                  </div>
                  <Badge>{d.track}</Badge>
                </div>
                <p className="mt-4 text-sm leading-relaxed text-fg-faint">
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-dim">
                    {t.thesis.trad}&nbsp;·&nbsp;
                  </span>
                  {d.trad}
                </p>
                <p className="mt-3 text-sm leading-relaxed text-fg">
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-amber">
                    {t.thesis.ours}&nbsp;·&nbsp;
                  </span>
                  {d.ours}
                </p>
              </div>
            );
          })}
        </div>

        <p className="mt-6 font-mono text-xs text-fg-faint">{t.thesis.foot}</p>
      </div>
    </section>
  );
}

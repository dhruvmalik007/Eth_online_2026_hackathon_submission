import { CheckCircle2, CircleDashed, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Dict } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// Per-track status: indexes align with t.prizes.tracks order.
const STATUS = ["shipped", "shipped", "planned", "planned"] as const;
const VARIANTS = ["graph", "graph", "oneinch", "uniswap"] as const;
// Per-requirement completion: [trackIdx][reqIdx]. A planned track can still have
// requirements already satisfied (e.g. git history, v4 analysis tooling).
const REQ_DONE: boolean[][] = [
  [true, true, true, true],
  [true, true, true, true],
  [false, false, false, true],
  [true, false, true, false],
];

export function PrizeTracks({ t }: { t: Dict }) {

  return (
    <section id="prizes" className="border-b border-edge py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-5">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-amber">
          {t.prizes.kicker}
        </p>
        <h2 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight md:text-4xl">
          {t.prizes.h2a}
          <span className="text-fg-dim">{t.prizes.h2b}</span>
        </h2>
        <p className="mt-5 max-w-3xl text-base leading-relaxed text-fg-dim">{t.prizes.lead}</p>

        <div className="mt-12 grid gap-5 lg:grid-cols-2">
          {t.prizes.tracks.map((track, ti) => {
            const status = STATUS[ti] ?? "planned";
            const statusLabel =
              status === "shipped" ? t.prizes.statusShipped : t.prizes.statusPlanned;
            return (
              <Card key={track.track} className="flex flex-col">
                <CardHeader className="border-b border-edge">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={VARIANTS[ti]}>{track.sponsor}</Badge>
                        <Badge>{track.track}</Badge>
                        <Badge variant={status === "shipped" ? "up" : "default"} className="gap-1">
                          {status === "shipped" ? (
                            <CheckCircle2 className="size-3" />
                          ) : (
                            <CircleDashed className="size-3" />
                          )}
                          {statusLabel}
                        </Badge>
                      </div>
                      <CardTitle className="mt-3 text-[13px] normal-case tracking-normal text-fg">
                        {track.title}
                      </CardTitle>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="flex items-center justify-end gap-1.5 font-mono text-xl font-semibold text-amber">
                        <Trophy className="size-4" />
                        {track.pool.split(" · ")[0]}
                      </p>
                      <p className="font-mono text-[10px] text-fg-faint">{track.pool}</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="mt-4 flex-1 space-y-3.5">
                  {track.mapping.map((m, mi) => {
                    const done = REQ_DONE[ti]?.[mi] ?? false;
                    return (
                      <div key={m.req} className="flex gap-2.5">
                        {done ? (
                          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-up" />
                        ) : (
                          <CircleDashed className="mt-0.5 size-4 shrink-0 text-fg-faint" />
                        )}
                        <div>
                          <p
                            className={cn(
                              "text-sm font-medium leading-snug",
                              done ? "text-fg" : "text-fg-dim",
                            )}
                          >
                            {m.req}
                          </p>
                          <p className="mt-1 text-xs leading-relaxed text-fg-faint">{m.proof}</p>
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            );
          })}
        </div>

        <p className="mt-8 font-mono text-xs leading-relaxed text-fg-faint">{t.prizes.foot}</p>
      </div>
    </section>
  );
}

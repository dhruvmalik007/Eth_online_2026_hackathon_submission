import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Dict } from "@/lib/i18n";

const GROUP_VARIANTS = ["graph", "amber", "oneinch", "default"] as const;

export function Stack({ t }: { t: Dict }) {

  return (
    <section id="stack" className="border-b border-edge py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-5">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-amber">
          {t.stack.kicker}
        </p>
        <h2 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight md:text-4xl">
          {t.stack.h2a}
          <span className="text-fg-dim">{t.stack.h2b}</span>
        </h2>

        <div className="mt-12 grid gap-5 md:grid-cols-2">
          {t.stack.groups.map((g, gi) => (
            <Card key={g.group}>
              <CardHeader className="border-b border-edge pb-3">
                <CardTitle className="flex items-center gap-2">
                  {g.group}
                  <Badge variant={GROUP_VARIANTS[gi]}>{g.items.length} pkgs</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="mt-4 space-y-4">
                {g.items.map((it) => (
                  <div key={it.name}>
                    <p className="font-mono text-[13px] font-semibold text-fg">{it.name}</p>
                    <p className="mt-1 text-xs leading-relaxed text-fg-dim">{it.role}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}

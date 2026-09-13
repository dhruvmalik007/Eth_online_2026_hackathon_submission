import { ArrowUpRight, PlayCircle } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Dict } from "@/lib/i18n";

export function DemoVideo({ t }: { t: Dict }) {

  return (
    <section id="demo" className="border-b border-edge py-20 md:py-28">
      <div className="mx-auto max-w-5xl px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-amber">
              {t.demo.kicker}
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">{t.demo.h2}</h2>
          </div>
          <Badge variant="amber">{t.demo.badge}</Badge>
        </div>
        <p className="mt-5 max-w-3xl text-base leading-relaxed text-fg-dim">{t.demo.lead}</p>

        <figure className="term mt-10 border border-edge-2">
          <div className="flex items-center justify-between border-b border-edge px-4 py-2.5">
            <div className="flex items-center gap-2 font-mono text-[11px] text-fg-dim">
              <PlayCircle className="size-4 text-amber" />
              agentic-ems — pitch
            </div>
            <p className="font-mono text-[10px] text-fg-faint">demo-pitch.mp4</p>
          </div>
          <video
            className="aspect-video w-full"
            src="/demo-pitch.mp4"
            controls
            preload="metadata"
            playsInline
          />
        </figure>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <a href="/studio" className={buttonVariants({ variant: "outline" })}>
            {t.demo.studioCta}
            <ArrowUpRight className="size-4" />
          </a>
          <p className="font-mono text-[11px] text-fg-faint">{t.demo.studioNote}</p>
        </div>
      </div>
    </section>
  );
}

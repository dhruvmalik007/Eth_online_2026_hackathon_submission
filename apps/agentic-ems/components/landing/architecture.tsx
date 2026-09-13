import { ArchitectureFlowLazy } from "@/components/landing/architecture-flow-lazy";
import type { Dict } from "@/lib/i18n";

export function Architecture({ t }: { t: Dict }) {

  return (
    <section id="architecture" className="border-b border-edge py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-5">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-amber">
          {t.arch.kicker}
        </p>
        <h2 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight md:text-4xl">
          {t.arch.h2a}
          <span className="text-fg-dim">{t.arch.h2b}</span>
        </h2>
        <p className="mt-5 max-w-3xl text-base leading-relaxed text-fg-dim">{t.arch.lead}</p>
        <div className="mt-10">
          <ArchitectureFlowLazy />
        </div>
        <p className="mt-4 font-mono text-xs text-fg-faint">{t.arch.hint}</p>
      </div>
    </section>
  );
}

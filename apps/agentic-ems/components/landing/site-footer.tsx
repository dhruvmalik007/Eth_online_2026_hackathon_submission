import { Separator } from "@/components/ui/separator";
import type { Dict } from "@/lib/i18n";

export function SiteFooter({ t }: { t: Dict }) {

  return (
    <footer className="py-14">
      <div className="mx-auto max-w-7xl px-5">
        <div className="flex flex-col justify-between gap-8 md:flex-row md:items-start">
          <div className="max-w-md">
            <p className="flex items-center gap-2.5 font-mono text-sm">
              <span className="inline-block h-3.5 w-1.5 bg-amber" aria-hidden />
              <span className="font-semibold">AGENTIC EMS</span>
            </p>
            <p className="mt-3 text-sm leading-relaxed text-fg-dim">{t.footer.about}</p>
          </div>
          <div className="grid grid-cols-2 gap-x-12 gap-y-2 font-mono text-xs md:grid-cols-1">
            <a
              href="https://thegraph.com/docs/en/subgraphs/existing-subgraphs/standard-subgraphs/"
              target="_blank"
              rel="noreferrer"
              className="text-fg-dim transition-colors hover:text-amber"
            >
              {t.footer.links.graph}
            </a>
            <a
              href="https://1inch.com/aqua"
              target="_blank"
              rel="noreferrer"
              className="text-fg-dim transition-colors hover:text-amber"
            >
              {t.footer.links.oneinch}
            </a>
            <a
              href="https://developers.uniswap.org/docs"
              target="_blank"
              rel="noreferrer"
              className="text-fg-dim transition-colors hover:text-amber"
            >
              {t.footer.links.uniswap}
            </a>
            <a
              href="https://github.com/dhruvmalik007/Eth_online_2026_hackathon_submission"
              target="_blank"
              rel="noreferrer"
              className="text-fg-dim transition-colors hover:text-amber"
            >
              {t.footer.links.repo}
            </a>
            <a href="/studio" className="text-fg-dim transition-colors hover:text-amber">
              {t.footer.links.studio}
            </a>
          </div>
        </div>
        <Separator className="my-8" />
        <div className="flex flex-col justify-between gap-3 font-mono text-[11px] text-fg-faint md:flex-row">
          <p>{t.footer.submission}</p>
          <p>{t.footer.repro}</p>
        </div>
      </div>
    </footer>
  );
}

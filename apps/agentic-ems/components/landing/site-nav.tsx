import { Github, PlayCircle } from "lucide-react";
import { NavControls } from "@/components/landing/nav-controls";
import type { Dict } from "@/lib/i18n";
import type { Lang, Theme } from "@/lib/i18n-meta";

const LINKS = [
  { href: "#thesis", key: "thesis" },
  { href: "#architecture", key: "architecture" },
  { href: "#live", key: "live" },
  { href: "#prizes", key: "prizes" },
  { href: "#v4", key: "v4" },
  { href: "#stack", key: "stack" },
  { href: "#demo", key: "demo" },
] as const;

/**
 * Server Component. All copy comes from the dictionary the page resolved on the
 * server; the only interactive part is the language/theme control, which is
 * isolated in `NavControls` so the nav itself costs no client JS.
 */
export function SiteNav({ t, lang, theme }: { t: Dict; lang: Lang; theme: Theme }) {
  return (
    <header className="sticky top-0 z-50 border-b border-edge bg-ink/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-5">
        <a href="#top" className="flex items-center gap-2.5 font-mono text-sm tracking-tight">
          <span className="inline-block h-3.5 w-1.5 bg-amber" aria-hidden />
          <span className="font-semibold text-fg">AGENTIC&nbsp;EMS</span>
          <span className="hidden text-fg-faint lg:inline">/ ethonline 2026</span>
        </a>

        <nav className="hidden items-center gap-5 xl:flex">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-dim transition-colors hover:text-amber"
            >
              {t.nav[l.key]}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <a
            href="/studio"
            title={t.nav.productDemoHint}
            className="flex items-center gap-1.5 bg-amber px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-on-amber transition-all hover:opacity-90"
          >
            <PlayCircle className="size-3.5" />
            {t.nav.productDemo}
          </a>

          <NavControls
            lang={lang}
            theme={theme}
            labels={{ lang: t.nav.lang, theme: t.nav.theme }}
          />

          <a
            href="https://github.com/renu_malik/Eth_online_2026_hackathon_submission"
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub"
            className="hidden size-8 items-center justify-center border border-edge-2 text-fg-dim transition-colors hover:border-amber/60 hover:text-amber sm:flex"
          >
            <Github className="size-4" />
          </a>
        </div>
      </div>
    </header>
  );
}

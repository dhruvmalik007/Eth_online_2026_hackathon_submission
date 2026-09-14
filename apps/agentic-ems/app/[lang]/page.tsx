import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SiteNav } from "@/components/landing/site-nav";
import { Ticker } from "@/components/landing/ticker";
import { Hero } from "@/components/landing/hero";
import { Thesis } from "@/components/landing/thesis";
import { Architecture } from "@/components/landing/architecture";
import { LiveData } from "@/components/landing/live-data";
import { PrizeTracks } from "@/components/landing/prize-tracks";
import { V4Strategies } from "@/components/landing/v4-strategies";
import { Stack } from "@/components/landing/stack";
import { DemoVideo } from "@/components/landing/demo-video";
import { SiteFooter } from "@/components/landing/site-footer";
import { DICTS } from "@/lib/i18n";
import { landingStats } from "@/lib/live/subgraph-stats";
import { DEFAULT_THEME, LANGS, type Lang } from "@/lib/i18n-meta";

/**
 * Locale-segmented landing page.
 *
 * All three locales are prerendered at build time and served from the CDN, and
 * the dictionary is resolved here on the server — so the translations are never
 * part of any client bundle. The only client JavaScript on this page is the nav
 * control and the lazily-loaded React Flow diagram.
 */
export function generateStaticParams() {
  return LANGS.map((l) => ({ lang: l.code }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  const t = DICTS[(lang as Lang) in DICTS ? (lang as Lang) : "en"];
  return {
    title: "Agentic EMS — on-chain fixed income, executed by agents",
    description: t.hero.leadA,
    alternates: {
      canonical: `/${lang}`,
      languages: Object.fromEntries(LANGS.map((l) => [l.code, `/${l.code}`])),
    },
  };
}

export default async function LocalePage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!(lang in DICTS)) notFound();

  const t = DICTS[lang as Lang];
  // Theme is a client concern (applied pre-paint by the inline script in the root
  // layout) — reading it here would opt this page out of static rendering.
  const theme = DEFAULT_THEME;
  // Counted from the registry at build time, so the hero and the tape carry no literals.
  const stats = landingStats();

  return (
    <>
      <SiteNav t={t} lang={lang as Lang} theme={theme} />
      <main id="top">
        <Hero t={t} stats={stats} />
        <Ticker rows={stats.tape} />
        <Thesis t={t} />
        <Architecture t={t} />
        <LiveData t={t} stats={stats} />
        <PrizeTracks t={t} />
        <V4Strategies t={t} />
        <Stack t={t} />
        <DemoVideo t={t} />
      </main>
      <SiteFooter t={t} />
    </>
  );
}

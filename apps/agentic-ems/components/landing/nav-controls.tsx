"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Languages, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { LANGS, LANG_COOKIE, THEME_COOKIE, type Lang, type Theme } from "@/lib/i18n-meta";

/**
 * The only Client Component on the landing page.
 *
 * Language switching is a navigation between the three prerendered locale routes,
 * so the page stays statically generated and CDN-cached with the dictionary
 * resolved on the server. The theme is toggled in place — it is pure
 * presentation, so it needs no server round-trip.
 */

function setCookie(name: string, value: string) {
  document.cookie = `${name}=${value}; path=/; max-age=31536000; samesite=lax`;
}

export function NavControls({
  lang,
  theme,
  labels,
}: {
  lang: Lang;
  theme: Theme;
  labels: { lang: string; theme: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [current, setCurrent] = useState<Theme>(theme);

  // The pre-paint script may have applied a different theme; sync once mounted.
  useEffect(() => {
    setCurrent(document.documentElement.classList.contains("light") ? "light" : "dark");
  }, []);

  const chooseLang = (next: Lang) => {
    if (next === lang) return;
    setCookie(LANG_COOKIE, next);
    const rest = pathname.replace(/^\/(en|hi|fr)(?=\/|$)/, "");
    router.push(`/${next}${rest}`);
  };

  const toggleTheme = () => {
    const next: Theme = current === "dark" ? "light" : "dark";
    setCurrent(next);
    setCookie(THEME_COOKIE, next);
    const root = document.documentElement;
    root.classList.remove("dark", "light");
    root.classList.add(next);
  };

  return (
    <>
      <div className="flex items-center border border-edge-2" role="group" aria-label={labels.lang}>
        <Languages className="mx-1.5 size-3.5 text-fg-faint" aria-hidden />
        {LANGS.map((l) => (
          <button
            key={l.code}
            onClick={() => chooseLang(l.code)}
            aria-label={l.native}
            aria-pressed={lang === l.code}
            className={cn(
              "px-2 py-1.5 font-mono text-[11px] transition-colors",
              lang === l.code ? "bg-panel-2 text-amber" : "text-fg-faint hover:text-fg",
            )}
          >
            {l.label}
          </button>
        ))}
      </div>

      <button
        onClick={toggleTheme}
        aria-label={labels.theme}
        className="flex size-8 items-center justify-center border border-edge-2 text-fg-dim transition-colors hover:border-amber/60 hover:text-amber"
      >
        {current === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
      </button>
    </>
  );
}

import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_LANG, LANG_COOKIE, LANGS, isLang } from "@/lib/i18n-meta";

/**
 * Sends `/` to the visitor's preferred locale.
 *
 * Locale lives in the path (`/en`, `/hi`, `/fr`) rather than a cookie read inside
 * the page, because reading cookies opts a route out of static rendering — and a
 * marketing page that cannot be cached at the edge is a bad trade for every
 * visitor. Middleware runs at the edge, so this redirect is cheap and the three
 * locale pages stay fully prerendered.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname !== "/") return NextResponse.next();

  const cookieLang = request.cookies.get(LANG_COOKIE)?.value;
  const preferred = pickLocale(
    isLang(cookieLang) ? cookieLang : undefined,
    request.headers.get("accept-language"),
  );

  return NextResponse.redirect(new URL(`/${preferred}`, request.url), 307);
}

function pickLocale(cookie: string | undefined, acceptLanguage: string | null): string {
  if (cookie && isLang(cookie)) return cookie;
  if (acceptLanguage) {
    const ranked = acceptLanguage
      .split(",")
      .map((part) => {
        const [tag, q] = part.trim().split(";q=");
        return { tag: tag.trim().toLowerCase(), q: q ? Number(q) : 1 };
      })
      .sort((a, b) => b.q - a.q);
    for (const { tag } of ranked) {
      const base = tag.split("-")[0];
      const match = LANGS.find((l) => l.code === base);
      if (match) return match.code;
    }
  }
  return DEFAULT_LANG;
}

export const config = {
  // Only the site root; everything else (including /demo and /studio) is untouched.
  matcher: ["/"],
};

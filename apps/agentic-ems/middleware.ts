import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_LANG, LANG_COOKIE, LANGS, isLang } from "@/lib/i18n-meta";

/**
 * Locale redirect and the response security headers, in one pass.
 *
 * ## Why the headers live here rather than in `next.config`
 *
 * `next.config`'s `headers()` is applied per route and cannot see the request, so it cannot vary with
 * `NODE_ENV` — and HSTS must not be sent from a non-TLS origin or `localhost` becomes unusable. It
 * also could not attach the CSP report URI relative to the deployment. Middleware already runs for
 * every route, so the two concerns share one pass at the edge.
 *
 * ## Why the Content-Security-Policy is Report-Only
 *
 * An enforcing policy at this point would be guesswork: this app loads Privy's SDK, the WalletConnect
 * relay, and whichever execution and indexer hosts its `NEXT_PUBLIC_*` variables name, and a directive
 * that misses one takes the sign-in flow down in production. So it ships as `Report-Only`, which the
 * browser enforces nothing from and reports everything about, and it is promoted once the reports
 * from a real deployment are empty. `/api/csp-report` is the collector.
 *
 * ## The one honest weakness
 *
 * `script-src` allows `'unsafe-inline'`. Next inlines its own bootstrap script, and the nonce that
 * would replace `'unsafe-inline'` has to be threaded through the render — which opts every page out of
 * static rendering. This app keeps `/en`, `/hi` and `/fr` prerendered on purpose (see the redirect
 * below), and a marketing page that cannot be cached at the edge is a bad trade for an XSS mitigation
 * that the other directives still partly cover. `object-src 'none'`, `base-uri 'self'`,
 * `frame-ancestors 'none'` and `form-action 'self'` are the ones doing the load-bearing work here.
 */

/** Third-party origins the browser has to reach, named rather than wildcarded where possible. */
const PRIVY = "https://auth.privy.io";
const PRIVY_WILDCARD = "https://*.privy.io";
/** Privy's embedded-wallet RPC and the WalletConnect/Reown relay the wallet sessions pair over. */
const PRIVY_RPC = "https://*.privy.systems";
const RELAY = ["https://*.walletconnect.com", "https://*.walletconnect.org", "https://*.reown.com"];
const RELAY_WS = ["wss://relay.walletconnect.com", "wss://*.walletconnect.org", "wss://*.reown.com"];
/** Log shipping, from the `NEXT_PUBLIC_BETTER_STACK_*` / `NEXT_PUBLIC_LOGTAIL_*` variables. */
const LOG_SHIPPING = ["https://*.betterstackdata.com", "https://*.logtail.com"];

/**
 * The app's own services, read from the variables the browser is already told about.
 *
 * Literal member access, because that is the only form Next inlines into an edge bundle — the same
 * rule `lib/envRules.test.ts` enforces for the app.
 */
function serviceOrigins(): string[] {
  return [process.env["NEXT_PUBLIC_EXECUTION_URL"], process.env["NEXT_PUBLIC_INDEXER_URL"]]
    .map((value) => value?.trim())
    .filter((value): value is string => value !== undefined && value.length > 0)
    .map((value) => {
      try {
        return new URL(value).origin;
      } catch {
        return "";
      }
    })
    .filter((value) => value.length > 0);
}

function contentSecurityPolicy(): string {
  const connect = ["'self'", PRIVY, PRIVY_WILDCARD, PRIVY_RPC, ...RELAY, ...RELAY_WS, ...LOG_SHIPPING, ...serviceOrigins()];
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    // Privy and Next both inject styles; a nonce here has the same static-rendering cost as above.
    "style-src 'self' 'unsafe-inline'",
    `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${PRIVY} ${PRIVY_WILDCARD}`,
    `frame-src ${PRIVY} ${PRIVY_WILDCARD}`,
    `connect-src ${[...new Set(connect)].join(" ")}`,
    "report-uri /api/csp-report",
  ].join("; ");
}

/** Applied to every response this middleware produces, including redirects. */
function harden(response: NextResponse, request: NextRequest): NextResponse {
  const headers = response.headers;
  headers.set("Content-Security-Policy-Report-Only", contentSecurityPolicy());
  headers.set("X-Content-Type-Options", "nosniff");
  // `DENY` rather than `SAMEORIGIN`: nothing here is designed to be framed, and `frame-ancestors` above
  // says the same thing for browsers that prefer it.
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  // Only over TLS, and only where it is true: `localhost` and a preview over plain HTTP would
  // otherwise be pinned to https by a header that cannot be taken back for the max-age.
  if (request.nextUrl.protocol === "https:") {
    headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  }
  return response;
}

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
  if (pathname !== "/") return harden(NextResponse.next(), request);

  const cookieLang = request.cookies.get(LANG_COOKIE)?.value;
  const preferred = pickLocale(
    isLang(cookieLang) ? cookieLang : undefined,
    request.headers.get("accept-language"),
  );

  return harden(NextResponse.redirect(new URL(`/${preferred}`, request.url), 307), request);
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
  /**
   * Every route except the build's static assets, which are immutable and already served with their
   * own long-lived cache headers.
   *
   * This used to be `["/"]`, so `/demo`, `/studio` and every `/api/*` route were served without a
   * single security header — including the ones that now require a session.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpe?g|gif|svg|webp|ico|mp4|webm|woff2?|ttf|txt|xml)$).*)"],
};

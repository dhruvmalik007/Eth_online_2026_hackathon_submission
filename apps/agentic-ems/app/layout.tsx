import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Noto_Sans_Devanagari } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

// Devanagari fallback for the हिन्दी locale.
const notoDeva = Noto_Sans_Devanagari({
  subsets: ["devanagari"],
  variable: "--font-noto-deva",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Agentic EMS — on-chain fixed income, executed by agents",
  description:
    "An agentic Execution Management System for on-chain fixed income: standardized subgraph data from The Graph, quant risk math, and execution routed through Uniswap v4 and 1inch. ETHOnline 2026.",
};

/**
 * A tiny pre-paint script (~190 bytes, inline in the HTML — it adds nothing to
 * any JS bundle) that applies the stored theme and locale before first paint.
 *
 * Why not read cookies with `cookies()` in the layout: that is a dynamic API, and
 * using it here would opt **every** route out of static rendering and forfeit CDN
 * caching. Locale lives in the path instead (see `app/[lang]`), and theme is a
 * pure presentation concern, so it belongs on the client.
 */
const prefsInit = `(function(){try{var d=document.documentElement;var m=document.cookie.match(/(?:^|;\\s*)ems-theme=(dark|light)/);var t=m?m[1]:"dark";d.classList.remove("dark","light");d.classList.add(t);var s=location.pathname.split("/")[1];if(s==="en"||s==="hi"||s==="fr")d.lang=s}catch(e){}})()`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrains.variable} ${notoDeva.variable} dark`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: prefsInit }} />
      </head>
      <body className="min-h-screen bg-ink font-sans text-fg antialiased">{children}</body>
    </html>
  );
}

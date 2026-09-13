"use client";

import { KeyRound } from "lucide-react";

/**
 * Shown on /studio when REACTOR_API_KEY is not configured.
 * Recreated 2026-09-07 (original was lost in the landing rework) —
 * behavior preserved: prompt the operator to add the key and restart.
 */
export function SetupRequired() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 text-zinc-100">
      <div className="max-w-md border border-zinc-800 bg-zinc-900/60 p-8">
        <div className="flex items-center gap-3">
          <KeyRound className="size-5 text-amber-400" />
          <h1 className="font-mono text-sm font-semibold uppercase tracking-[0.18em]">
            Studio setup required
          </h1>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-zinc-400">
          The FastH3 video studio needs a Reactor API key to queue episodes.
        </p>
        <ol className="mt-5 list-decimal space-y-2 pl-5 text-sm text-zinc-300">
          <li>
            Copy <code className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-xs">.env.example</code>{" "}
            → <code className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-xs">.env.local</code>
          </li>
          <li>
            Set <code className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-xs">REACTOR_API_KEY=rk_…</code>{" "}
            (reactor.inc/account/api-keys)
          </li>
          <li>Restart <code className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-xs">pnpm dev</code></li>
        </ol>
        <a
          href="/"
          className="mt-6 inline-block font-mono text-xs text-zinc-400 underline-offset-4 hover:text-amber-400 hover:underline"
        >
          ← back to the landing page
        </a>
      </div>
    </main>
  );
}

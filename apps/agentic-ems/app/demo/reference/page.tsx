import * as React from "react";
import Link from "next/link";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { probeServices } from "@/lib/server/service-health";

/**
 * The workflow reference, served from the app.
 *
 * Rendered from the same file the repo carries rather than duplicated into JSX: two copies of a
 * transaction list drift, and the one that drifts is always the one nobody is looking at. Read at
 * request time so a regenerated manifest shows up without a rebuild.
 *
 * The markdown is rendered into links rather than printed verbatim, because the point of this page
 * during a demo is that an explorer URL is clickable. A wall of `<pre>` makes the audience read a
 * hash instead of watching it open.
 */
export const dynamic = "force-dynamic";

const URL_RE = /https?:\/\/[^\s|)]+/g;

/** Linkify a plain line, leaving the surrounding prose intact. */
function withLinks(text: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_RE)) {
    const url = match[0];
    const at = match.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    out.push(
      <a
        key={`${keyPrefix}-${at}`}
        href={url}
        target="_blank"
        rel="noreferrer noopener"
        className="break-all text-amber underline decoration-amber/30 underline-offset-2 hover:decoration-amber"
      >
        {url}
      </a>,
    );
    last = at + url.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Backticked spans become mono runs; everything else gets linkified. */
function render(text: string, keyPrefix: string): React.ReactNode[] {
  return text.split(/`([^`]+)`/).map((part, i) =>
    i % 2 === 1 ? (
      <code key={`${keyPrefix}-c${i}`} className="text-fg">
        {part}
      </code>
    ) : (
      <React.Fragment key={`${keyPrefix}-t${i}`}>{withLinks(part, `${keyPrefix}-${i}`)}</React.Fragment>
    ),
  );
}

type Block =
  | { kind: "h2" | "h3"; text: string }
  | { kind: "p"; text: string }
  | { kind: "li"; text: string }
  | { kind: "hr" }
  | { kind: "table"; rows: string[][] };

/** Just enough markdown for this file: headings, rules, tables, bullets, links. */
function parse(md: string): Block[] {
  const blocks: Block[] = [];
  const cells = (line: string) => line.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  for (const raw of md.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (/^---+$/.test(line.trim())) blocks.push({ kind: "hr" });
    else if (line.startsWith("### ")) blocks.push({ kind: "h3", text: line.slice(4) });
    else if (line.startsWith("## ")) blocks.push({ kind: "h2", text: line.slice(3) });
    else if (line.startsWith("|")) {
      if (/^\|[\s:|-]+\|$/.test(line)) continue;
      const row = cells(line);
      const prev = blocks[blocks.length - 1];
      if (prev?.kind === "table") prev.rows.push(row);
      else blocks.push({ kind: "table", rows: [row] });
    } else if (/^[-*] /.test(line)) blocks.push({ kind: "li", text: line.slice(2) });
    else blocks.push({ kind: "p", text: line });
  }
  return blocks;
}


/**
 * Service status for the demo.
 *
 * The indexer is declared OK here rather than probed. A deployed Vercel page resolves
 * `localhost:3001` to the visitor's own machine, so probing it from staging can only ever report
 * failure — an artefact of where the page is served, not of whether the indexer is running. The
 * live indexer is reachable from this machine and answers `database.reachable=true`.
 *
 * The transaction counts below are read from the manifest, so they are the real ones.
 */
function StatusStrip({ txCount, services }: { txCount: number; services: readonly { label: string; value: string; tone: "ok" | "warn" | "info" }[] }) {
  // Service rows are probed, not asserted — see lib/server/service-health.ts. The on-chain count
  // comes from the manifest this page already reads.
  const items: { label: string; value: string; tone: "ok" | "warn" | "info" }[] = [
    ...services,
    { label: "on-chain", value: `${txCount} tx`, tone: txCount > 0 ? "ok" : "warn" },
  ];
  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-2 border border-edge-2 bg-panel px-4 py-3">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-2">
          <span
            className={`h-1.5 w-1.5 ${it.tone === "ok" ? "bg-amber" : it.tone === "warn" ? "bg-red-400" : "bg-fg-faint"}`}
            aria-hidden
          />
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">
            {it.label}
          </span>
          <span
            className={`font-mono text-[11px] ${it.tone === "ok" ? "text-amber" : it.tone === "warn" ? "text-red-400" : "text-fg-dim"}`}
          >
            {it.value}
          </span>
        </span>
      ))}
    </div>
  );
}

export default async function ReferencePage() {
  const markdown = (() => {
    try {
      return readFileSync(join(process.cwd(), "public", "reference", "workflow-reference.md"), "utf8");
    } catch {
      return "Reference not found. Regenerate it with the workflow runner.";
    }
  })();

  const txCount = (() => {
    try {
      const m = JSON.parse(
        readFileSync(join(process.cwd(), "public", "reference", "workflow-manifest.json"), "utf8"),
      ) as { transactions?: unknown[]; orders?: { txHash?: string }[] };
      if (m.transactions?.length) return m.transactions.length;
      // Each order carries one broadcast hash; the bridge is tracked separately under bridgeProgress.
      return (m.orders ?? []).filter((o) => Boolean(o.txHash)).length;
    } catch {
      return 0;
    }
  })();

  const services = await probeServices();

  return (
    <div className="flex min-h-screen flex-col bg-ink">
      <header className="flex flex-wrap items-center gap-3 border-b border-edge bg-panel px-4 py-3">
        <Link href="/demo" className="font-mono text-xs uppercase tracking-[0.2em] text-fg-dim hover:text-amber">
          ← Desk
        </Link>
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-fg-faint">
          · workflow reference
        </span>
        <a
          href="/reference/workflow-manifest.json"
          className="ml-auto border border-edge-2 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-fg-dim hover:border-amber/60 hover:text-amber"
        >
          manifest.json
        </a>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
        <StatusStrip txCount={txCount} services={services} />
        {parse(markdown).map((block, i) => {
          if (block.kind === "hr") return <hr key={i} className="my-8 border-edge-2" />;
          if (block.kind === "h2")
            return (
              <h2
                key={i}
                className="mt-8 border-b border-edge-2 pb-2 font-mono text-[11px] uppercase tracking-[0.2em] text-amber"
              >
                {block.text}
              </h2>
            );
          if (block.kind === "h3")
            return (
              <h3 key={i} className="mt-6 font-mono text-[11px] uppercase tracking-[0.16em] text-fg">
                {block.text}
              </h3>
            );
          if (block.kind === "table")
            return (
              <div key={i} className="mt-4 overflow-x-auto border border-edge-2">
                <table className="w-full border-collapse">
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={r} className={r === 0 ? "bg-panel" : ""}>
                        {row.map((cell, c) => (
                          <td
                            key={c}
                            className={`border-b border-edge-2 px-3 py-2 align-top font-mono text-[11px] ${
                              r === 0 ? "uppercase tracking-[0.12em] text-fg-faint" : "text-fg-dim"
                            }`}
                          >
                            {r === 0 ? cell : render(cell, `${i}-${r}-${c}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          if (block.kind === "li")
            return (
              <div key={i} className="mt-1.5 flex gap-2 pl-1">
                <span className="select-none font-mono text-[11px] text-fg-faint">·</span>
                <p className="font-mono text-[11px] leading-relaxed text-fg-dim">
                  {render(block.text, `${i}`)}
                </p>
              </div>
            );
          return (
            <p key={i} className="mt-3 font-mono text-[11px] leading-relaxed text-fg-dim">
              {render(block.text, `${i}`)}
            </p>
          );
        })}
      </main>
    </div>
  );
}

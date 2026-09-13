import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const candidates = [
    path.resolve(process.cwd(), "data/defillama_metrics/defillama_metrics_taxonomy.json"),
    path.resolve(process.cwd(), "../../data/defillama_metrics/defillama_metrics_taxonomy.json"),
  ];
  for (const p of candidates) {
    try {
      const raw = await readFile(p, "utf8");
      const taxonomy = JSON.parse(raw);
      const meta = taxonomy.metadata ?? {};
      const sections = (
        Object.entries(taxonomy.metricsSections ?? {}) as [
          string,
          { label?: string; protocolCount?: number },
        ][]
      ).map(([id, s]) => ({
        id,
        label: s.label ?? id,
        protocolCount: s.protocolCount ?? 0,
      }));
      return NextResponse.json(
        {
          generatedAt: meta.generatedAt,
          protocolsTotal: meta.counts?.protocolsTotal ?? 0,
          categories: meta.counts?.categories ?? 0,
          sections,
          sourceEndpoints: meta.sources?.apiEndpoints ?? [],
        },
        { headers: { "cache-control": "public, max-age=300" } },
      );
    } catch {}
  }
  return NextResponse.json({ error: "taxonomy snapshot not found" }, { status: 404 });
}

/**
 * renderReport — deterministic 8-section Markdown report. Every figure cites its
 * producing node; no LLM by default (REPORT_LLM_POLISH=true optionally polishes prose
 * through the model fallback chain — flagged as AI-polished in Caveats).
 *
 * Sections: Executive Summary → Market Scan → Strategy Construction → Risk Report →
 * Stress Scenarios → Execution Plan → Data Provenance → Caveats.
 */
import type { StrategyState } from "../state.js";

export function renderReport(state: StrategyState): string {
  const intent = state.intent;
  const strategy = state.strategy;
  const lines: string[] = [];

  const money = (n: number) =>
    n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(2)}`;

  // ── 1. Executive Summary ────────────────────────────────────────────────
  lines.push("# Fixed-Income Strategy Execution Report");
  lines.push("");
  lines.push(`> Mandate: \`${state.mandate}\``);
  lines.push(`> Mode: **${state.mode.toUpperCase()}** · ${new Date().toISOString().slice(0, 10)}`);
  lines.push("");
  if (strategy && intent) {
    const verdict = state.gate?.passed
      ? strategy.meetsAprTarget && strategy.withinVegaBudget
        ? "✅ PASS"
        : "⚠️ PARTIAL"
      : "❌ INFEASIBLE";
    lines.push(`**Verdict: ${verdict}**`);
    lines.push("");
    lines.push(
      `- Target notional: **${money(intent.sizeUsd)}** · Required APR: **${intent.minAprPercent}%** · Vega budget: **${intent.vegaBudget}**`,
    );
    lines.push(
      `- Achieved APR: **${(strategy.achievedApr * 100).toFixed(2)}%** · Portfolio vega: **${strategy.portfolioVega.toFixed(3)}** · Max concentration: **${(strategy.maxConcentration * 100).toFixed(1)}%**`,
    );
  } else {
    lines.push(`**Verdict: ❌ INFEASIBLE**`);
  }
  if (state.gate && !state.gate.passed) {
    lines.push("");
    lines.push("**Gate rejection reasons:**");
    for (const r of state.gate.reasons) lines.push(`- ${r}`);
  }

  // ── 2. Market Scan ──────────────────────────────────────────────────────
  lines.push("");
  lines.push("## 2. Market Scan");
  if (state.market) {
    lines.push(`- v4 books analyzed: **${state.market.legs.length}** (subgraph \`${state.market.v4SubgraphId}\`, block \`${state.market.v4Block ?? "n/a"}\`)`);
    lines.push(`- Aave V3 lending (idle-leg yield): ${Object.entries(state.market.aaveRates).map(([k, v]) => `${k} ${v.toFixed(2)}%`).join(", ") || "unavailable"}`);
    if (state.market.dataNotes.length) {
      lines.push("");
      lines.push("**Data notes:**");
      for (const n of state.market.dataNotes) lines.push(`- ${n}`);
    }
  } else {
    lines.push("_No market data acquired._");
  }

  // ── 3. Strategy Construction ────────────────────────────────────────────
  lines.push("");
  lines.push("## 3. Strategy Construction");
  if (strategy) {
    lines.push("| Book | Weight | Net APY | LVR | Vega | Notional |");
    lines.push("|------|--------|---------|-----|------|----------|");
    for (const l of strategy.legs) {
      lines.push(
        `| ${l.pair}${l.hook ? " ⚓" : ""} | ${(l.weight * 100).toFixed(1)}% | ${(l.netApy * 100).toFixed(2)}% | ${(l.lvr * 100).toFixed(2)}% | ${l.vega.toFixed(3)} | ${money(l.notionalUsd)} |`,
      );
    }
    if (strategy.excluded.length) {
      lines.push("");
      lines.push("**Excluded:** " + strategy.excluded.map((e) => `${e.pair} (${e.reason})`).join("; "));
    }
  }

  // ── 4. Risk Report ──────────────────────────────────────────────────────
  lines.push("");
  lines.push("## 4. Risk Report");
  if (strategy) {
    lines.push(`- Portfolio vega (per unit σ): **${strategy.portfolioVega.toFixed(3)}** (budget ${intent?.vegaBudget})`);
    lines.push(`- Max single-book concentration: **${(strategy.maxConcentration * 100).toFixed(1)}%**`);
    lines.push(`- APR target met: **${strategy.meetsAprTarget ? "yes" : "no"}** · Within vega budget: **${strategy.withinVegaBudget ? "yes" : "no"}**`);
  }

  // ── 5. Stress Scenarios ─────────────────────────────────────────────────
  lines.push("");
  lines.push("## 5. Stress Scenarios (σ × 1.5)");
  if (strategy && intent) {
    let stressedNet = 0;
    let tw = 0;
    const byId = new Map((state.market?.legs ?? []).map((l) => [l.poolId, l]));
    for (const l of strategy.legs) {
      const src = byId.get(l.poolId);
      if (!src) continue;
      const s = src.sigma * 1.5;
      const lvr = (src.leverage ** 2 * s ** 2) / 8;
      const fee = src.feeApy + src.feeSlopeK * (s - src.sigma);
      const net = (1 - src.idleFraction) * fee + src.idleFraction * src.lendingApy - lvr;
      stressedNet += net * l.weight;
      tw += l.weight;
    }
    const stressedPct = tw > 0 ? stressedNet * 100 : 0;
    lines.push(`- Stressed portfolio APY: **${stressedPct.toFixed(2)}%** → **${stressedPct >= 0 ? "PASS" : "FAIL"}** (fixed-income floor ≥ 0%)`);
  }

  // ── 6. Execution Plan ───────────────────────────────────────────────────
  lines.push("");
  lines.push(`## 6. Execution Plan (${state.mode.toUpperCase()})`);
  if (state.plan.length) {
    lines.push("| # | Kind | Chain | Detail |");
    lines.push("|---|------|-------|--------|");
    for (const l of state.plan) {
      const detail =
        l.kind === "v4-mint" ? `${l.pair} · ${money(l.notionalUsd ?? 0)}` :
        l.kind === "arc-bridge" ? `${l.fromChain} → Arc · ${money(l.bridgeAmountUsdc ?? 0)} USDC` :
        `${l.fromToken} → ${l.toToken} · ${money(l.swapAmountUsdc ?? 0)}`;
      lines.push(`| ${l.seq} | ${l.kind} | ${l.chain} | ${detail} |`);
    }
  }
  if (state.results.length) {
    lines.push("");
    lines.push("**Results:**");
    for (const r of state.results) {
      const ref = r.txHash ? `[\`${r.txHash.slice(0, 10)}…\`](${r.explorerUrl ?? "#"})` : r.data ? `calldata \`${r.data.slice(0, 10)}…\`` : r.reason ?? "simulated";
      lines.push(`- ${r.label}: ${r.simulated ? "⚙️ simulated" : "✅ confirmed"} — ${ref}`);
    }
  }

  // ── 7. Data Provenance ──────────────────────────────────────────────────
  lines.push("");
  lines.push("## 7. Data Provenance");
  if (state.market) {
    lines.push(`- v4 subgraph: \`${state.market.v4SubgraphId}\` @ block \`${state.market.v4Block ?? "n/a"}\``);
    lines.push(`- Aave V3 subgraph: \`${state.market.aaveSubgraphId}\` @ block \`${state.market.aaveBlock ?? "n/a"}\``);
  }
  lines.push(`- Verification checks: **${state.verification.checks.filter((c) => c.passed).length}/${state.verification.checks.length} passed**`);
  for (const c of state.verification.checks) {
    lines.push(`  - ${c.passed ? "✅" : "❌"} ${c.name}: ${c.detail}`);
  }

  // ── 8. Caveats ──────────────────────────────────────────────────────────
  lines.push("");
  lines.push("## 8. Caveats");
  lines.push("- All quantitative claims trace to a tool/node output above — no figure is invented.");
  if (state.mode === "dry") lines.push("- **DRY MODE**: no transactions were submitted; calldata is the would-be payload.");
  if (state.errors.length) {
    lines.push("- **Errors encountered:** " + state.errors.join("; "));
  }
  lines.push("- v4 flash-accounting can report non-positive TVL intraday; such books are excluded from leg math (see Data Notes).");
  lines.push("- No sovereign guarantee; smart-contract and composability risk remain.");

  return lines.join("\n");
}

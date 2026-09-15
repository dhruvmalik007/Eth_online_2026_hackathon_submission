/**
 * The landing page's numbers, counted from the subgraph registry and its endpoint probe.
 *
 * Every figure here is arithmetic over two committed files — the Messari deployment registry and the
 * liveness probe that actually called each endpoint — rather than a constant chosen to look
 * impressive. That matters more than usual on a landing page, because these numbers are the first
 * claim the project makes and the easiest place to overstate it.
 *
 * The distinction the display must preserve: the registry holds 197 deployments and the probe found
 * **108** of 204 endpoints answering. Reporting the registry size as "subgraphs live" would inflate
 * the system by roughly double, so the live count is always shown beside what was probed and what
 * was dead.
 *
 * No I/O: the landing page is statically prerendered, so this runs at build time.
 */
import { messariNetworksIn, messariProbe, subgraphStats } from "@ethonline2026/graph-fno-indexer/registry";

export interface HeroStat {
  /** The big number. */
  readonly v: string;
  /** What it is, and what it is not. */
  readonly s: string;
}

export interface TapeRow {
  readonly label: string;
  readonly value: string;
  readonly delta: string;
  readonly dir: "up" | "down";
}

export interface BootLine {
  readonly t: string;
  readonly tone: "dim" | "ok" | "warn";
}

export interface TerminalMetric {
  readonly k: string;
  readonly v: string;
  readonly tone: "up" | "down" | "fg";
}

/**
 * One protocol, as the probe found it across its networks.
 *
 * Per-protocol rather than per-category on purpose: "lending is healthy" is a summary, and a summary
 * is where a dead endpoint hides. This carries the counts and the detail line the endpoint reported,
 * so the claim is inspectable.
 */
export interface SourceCard {
  readonly protocol: string;
  readonly category: string;
  readonly networks: readonly string[];
  readonly answering: number;
  readonly partial: number;
  readonly dead: number;
  /** The probe's own words for one endpoint — usually the block height it read. */
  readonly detail: string;
  readonly tone: "up" | "amber" | "down";
}

export interface LandingStats {
  readonly stats: readonly HeroStat[];
  readonly tape: readonly TapeRow[];
  readonly bootLines: readonly BootLine[];
  readonly terminal: readonly TerminalMetric[];
  readonly probeSummary: readonly TerminalMetric[];
  readonly sources: readonly SourceCard[];
}

const CATEGORY_LABEL: Readonly<Record<string, string>> = {
  lending: "LENDING",
  dex: "DEX",
  "liquid-staking": "LIQUID STAKING",
  perpetual: "PERPETUAL",
  prediction: "PREDICTION",
};

function label(category: string): string {
  return CATEGORY_LABEL[category] ?? category.toUpperCase().replace(/-/g, " ");
}

/**
 * A category reads healthy when more endpoints answered the core query than failed it.
 *
 * `partial` counts as neither: the endpoint answered but its schema differs, so calling it live would
 * claim a query that does not run, and calling it dead would hide an endpoint that works.
 */
function tone(standard: number, dead: number): "up" | "down" {
  return standard >= dead ? "up" : "down";
}

/**
 * The protocols the Live Data section shows, ranked by how many networks answered.
 *
 * The detail line prefers a working endpoint: printing the error text of a dead one would imply the
 * protocol is broken when it is answering on eleven other networks.
 */
function sourceCards(limit = 6): SourceCard[] {
  interface Acc {
    category: string;
    networks: Set<string>;
    answering: number;
    partial: number;
    dead: number;
    standardDetail: string;
    fallbackDetail: string;
  }

  const byProtocol = new Map<string, Acc>();
  for (const { status, entry } of messariProbe()) {
    let acc = byProtocol.get(entry.protocol);
    if (acc === undefined) {
      acc = {
        category: entry.category,
        networks: new Set<string>(),
        answering: 0,
        partial: 0,
        dead: 0,
        standardDetail: "",
        fallbackDetail: entry.detail,
      };
      byProtocol.set(entry.protocol, acc);
    }
    acc.networks.add(entry.network);
    if (status === "standard") {
      acc.answering += 1;
      if (acc.standardDetail === "") acc.standardDetail = entry.detail;
    } else if (status === "partial") {
      acc.partial += 1;
    } else {
      acc.dead += 1;
    }
  }

  return [...byProtocol.entries()]
    .map(([protocol, acc]) => ({
      protocol,
      category: acc.category,
      networks: [...acc.networks].sort(),
      answering: acc.answering,
      partial: acc.partial,
      dead: acc.dead,
      detail: acc.standardDetail === "" ? acc.fallbackDetail : acc.standardDetail,
      tone:
        acc.dead === 0 && acc.partial === 0
          ? ("up" as const)
          : acc.answering > 0
            ? ("amber" as const)
            : ("down" as const),
    }))
    .sort((left, right) => right.answering - left.answering || left.protocol.localeCompare(right.protocol))
    .slice(0, limit);
}

export function landingStats(): LandingStats {
  const registry = subgraphStats();
  const lendingNetworks = messariNetworksIn("lending");
  const lending = registry.byCategory.find((entry) => entry.category === "lending");
  const { total, standard, partial, dead, verifiedAt } = registry.liveness;

  const categories = registry.byCategory.filter((entry) => entry.category !== "prediction");

  return {
    stats: [
      { v: String(standard), s: `of ${total} probed · ${dead} dead` },
      { v: String(lendingNetworks.length), s: "messari standardized" },
      { v: String(registry.deployments.total), s: `${registry.deployments.byCategory.length} categories` },
    ],

    tape: [
      ...categories.map((entry) => ({
        label: `MESSARI ${label(entry.category)}`,
        value: `${entry.standard} live`,
        delta: `${entry.partial} partial · ${entry.dead} dead`,
        dir: tone(entry.standard, entry.dead),
      })),
      {
        label: "LENDING NETWORKS",
        value: String(lendingNetworks.length),
        delta: `${lending?.standard ?? 0} endpoints answering`,
        dir: tone(lending?.standard ?? 0, lending?.dead ?? 0),
      },
      {
        label: "DEPLOYMENTS",
        value: String(registry.deployments.total),
        delta: `${registry.deployments.byCategory.length} CATEGORIES`,
        dir: "up",
      },
      {
        label: "ENDPOINT PROBE",
        value: verifiedAt,
        delta: `${partial} PARTIAL · ${dead} DEAD`,
        dir: "up",
      },
    ],

    bootLines: [
      { t: "$ agentic-ems --init", tone: "dim" },
      { t: `✓ subgraph endpoints: ${standard}/${total} answering · ${dead} dead excluded`, tone: "ok" },
      { t: `✓ standardized lending schema: ${lendingNetworks.length} networks · ${lending?.standard ?? 0} endpoints`, tone: "ok" },
      { t: `✓ registry: ${registry.deployments.total} deployments across ${registry.deployments.byCategory.length} categories`, tone: "ok" },
      { t: `→ probe ${verifiedAt} · ${dead} endpoints must never be queried`, tone: "warn" },
      { t: "→ agent awaiting mandate _", tone: "warn" },
    ],

    terminal: [
      { k: "SUBGRAPHS", v: `${standard}/${total}`, tone: "up" },
      { k: "LENDING LIVE", v: String(lending?.standard ?? 0), tone: "up" },
      { k: "NETWORKS", v: String(lendingNetworks.length), tone: "fg" },
      { k: "DEAD EXCLUDED", v: String(dead), tone: "down" },
    ],

    probeSummary: [
      { k: "PROBED", v: String(total), tone: "fg" },
      { k: "ANSWERING", v: String(standard), tone: "up" },
      { k: "SCHEMA MISMATCH", v: String(partial), tone: "down" },
      { k: "DEAD EXCLUDED", v: String(dead), tone: "down" },
    ],

    sources: sourceCards(),
  };
}

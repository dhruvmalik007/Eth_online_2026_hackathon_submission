import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { HeaderAuthenticator } from "../src/http.js";
import type { YieldsFeed } from "../src/mandate/resolve.js";
import type { YieldsPoolRow } from "../src/mandate/schema.js";
import { makeRuntime, USER } from "./helpers.js";

/**
 * The route-level half of Phase 1a.
 *
 * The resolver's own suite proves it *produces* pools. These prove the route **reaches** it — a
 * resolver that works and is never called is the exact failure this whole item exists to fix, and it
 * typechecks perfectly.
 */

const ROWS: readonly YieldsPoolRow[] = [
  {
    pool: "aave-base-usdc",
    project: "aave-v3",
    chain: "Base",
    symbol: "USDC",
    tvlUsd: 40_000_000,
    apy: 4.0,
    apyMean30d: 4.2,
    apyBase: 4.2,
    apyReward: null,
    exposure: "single",
    stablecoin: true,
  },
  {
    pool: "uni-v4-base-usdc-usdt",
    project: "uniswap-v4",
    chain: "Base",
    symbol: "USDC-USDT",
    tvlUsd: 12_000_000,
    apy: 5.5,
    apyMean30d: 6.1,
    apyBase: 3.0,
    apyReward: 2.5,
    exposure: "multi",
    stablecoin: true,
  },
];

function countingFeed(rows: readonly YieldsPoolRow[]): { feed: YieldsFeed; calls: () => number } {
  let calls = 0;
  return {
    feed: {
      snapshot: async () => {
        calls += 1;
        return { rows, scrapedAt: "2026-09-13T00:00:00.000Z", url: "https://yields.test/pools" };
      },
    },
    calls: () => calls,
  };
}

const open: FastifyInstance[] = [];

async function harness(feed: YieldsFeed) {
  const runtime = makeRuntime({ yieldsFeed: feed });
  const app = buildApp({ runtime, authenticator: new HeaderAuthenticator() });
  await app.ready();
  open.push(app);
  return { app, runtime };
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((app) => app.close()));
});

const auth = { "x-user-id": USER };

async function sessionOf(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/sessions",
    headers: auth,
    payload: { agent: "v01" },
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { session: { sessionId: string } }).session.sessionId;
}

async function turn(
  app: FastifyInstance,
  sessionId: string,
  payload: Record<string, unknown>,
): Promise<Awaited<ReturnType<FastifyInstance["inject"]>>> {
  return app.inject({
    method: "POST",
    url: `/v1/sessions/${sessionId}/turns`,
    headers: auth,
    payload,
  });
}

describe("a turn with a mandateId", () => {
  it("resolves the mandate against the injected feed and starts the run", async () => {
    const { feed, calls } = countingFeed(ROWS);
    const { app } = await harness(feed);
    const sessionId = await sessionOf(app);

    const res = await turn(app, sessionId, {
      query: "Invest 100k USDC per the mandate",
      mandateId: "fi-lend-lp-base-v1",
    });

    expect(res.statusCode).toBe(200);
    // The proof that the route reached the resolver rather than passing empty arrays through.
    expect(calls()).toBe(1);
  });

  it("accepts an explicit pools list without consulting the feed at all", async () => {
    // Explicit wins: an operator who names pools means it, so the feed must not be fetched.
    const { feed, calls } = countingFeed(ROWS);
    const { app } = await harness(feed);
    const sessionId = await sessionOf(app);

    const res = await turn(app, sessionId, {
      query: "Use these pools",
      pools: ["0xpool"],
      protocols: ["aave-v3"],
    });

    expect(res.statusCode).toBe(200);
    expect(calls()).toBe(0);
  });

  it("rejects a mandate id that tries to leave the templates directory", async () => {
    // The id reaches `join(dir, id)`, so an unvalidated `../` walks out of it.
    const { app } = await harness(countingFeed(ROWS).feed);
    const sessionId = await sessionOf(app);

    const res = await turn(app, sessionId, {
      query: "go",
      mandateId: "../../etc/passwd",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/not a valid mandate id/);
  });

  it("reports an unknown mandate as bad input rather than a server failure", async () => {
    const { app } = await harness(countingFeed(ROWS).feed);
    const sessionId = await sessionOf(app);

    const res = await turn(app, sessionId, { query: "go", mandateId: "does-not-exist" });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/no mandate template/);
  });

  it("surfaces the resolver's funnel when nothing matches, naming the filter to relax", async () => {
    // An empty feed stands in for a chain that genuinely lacks the market. The message has to be
    // actionable, because "no pool matched" alone cannot be distinguished from a typo.
    const { app } = await harness(countingFeed([]).feed);
    const sessionId = await sessionOf(app);

    const res = await turn(app, sessionId, {
      query: "go",
      mandateId: "fi-lend-lp-base-v1",
    });

    expect(res.statusCode).toBe(400);
    const message = res.json().error.message as string;
    expect(message).toContain("leg-1");
    expect(message).toContain("project=aave-v3");
    expect(message).toContain("chain=Base");
  });
});

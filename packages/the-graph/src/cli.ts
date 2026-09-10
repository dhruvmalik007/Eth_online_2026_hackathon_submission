#!/usr/bin/env node
/**
 * graph-fno — CLI for the EMS data-indexation framework.
 *
 * Commands:
 *   health                       Check _meta on all configured endpoints
 *   query <file.graphql> [vars]  Execute an ad-hoc GraphQL file (vars as JSON string)
 *   extract-fno                  One-shot F&O aggregate -> stdout / file
 *   deltas --since-block N       Incremental delta pull (poller hot path)
 *   dry-run --network <chain>    End-to-end testnet dry run (no wallet needed)
 *   wallet-status                Resolve wallet mode + address without transacting
 */
import 'dotenv/config';
import { parse } from 'graphql';
import { loadEnv } from './config/index.js';
import { SubgraphRegistry } from './registry/SubgraphRegistry.js';
import { ProtocolRegistry } from './registry/ProtocolRegistry.js';
import type { ProtocolCategory } from './registry/ProtocolRegistry.js';
import { FnoDataExtractor } from './fno/FnoDataExtractor.js';
import { WalletSigner } from './wallet/WalletSigner.js';
import type { TestnetChain } from './config/index.js';
import { TESTNET_CHAINS } from './config/index.js';

type Args = Record<string, string | boolean | undefined>;

function parseArgs(argv: string[]): { command: string; args: Args } {
  const [command = 'help', ...rest] = argv;
  const args: Args = {};
  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i] ?? '';
    if (tok.startsWith('--')) {
      const key = tok.slice(2);
      const next = rest[i + 1];
      if (next === undefined || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    }
  }
  return { command, args };
}

function registry() {
  return SubgraphRegistry.fromEnv(loadEnv());
}

async function cmdHealth(): Promise<void> {
  const reg = registry();
  const refs = reg.list();
  if (refs.length === 0) {
    console.error(
      'No endpoints configured. Set STUDIO_PERP_SEPOLIA_ENDPOINT and/or GATEWAY_API_KEY (see .env.example).',
    );
    process.exitCode = 1;
    return;
  }
  for (const ref of refs) {
    const client = reg.get(ref.name);
    try {
      const h = await client.health({ timeoutMs: 8_000 });
      console.log(
        `[ok]   ${ref.name} (${ref.tier})  block=${h.blockNumber}  indexingErrors=${h.hasIndexingErrors}  deployment=${h.deployment.slice(0, 10)}…`,
      );
    } catch (err) {
      console.error(`[FAIL] ${ref.name} (${ref.tier})  ${(err as Error).message}`);
      process.exitCode = 1;
    }
  }
}

async function cmdQuery(args: Args): Promise<void> {
  const { readFileSync } = await import('node:fs');
  const file = args._[0];
  if (!file) throw new Error('usage: graph-fno query <file.graphql> [--vars \'{"k":"v"}\']');
  const reg = registry();
  const client = await reg.firstHealthy();
  const vars = typeof args.vars === 'string' ? JSON.parse(args.vars) : {};
  const document = parse(readFileSync(file, 'utf8'));
  const data = await client.execute(document, vars);
  console.log(JSON.stringify(data, null, 2));
}

async function cmdExtractFno(args: Args): Promise<void> {
  const reg = registry();
  const client = await reg.firstHealthy();
  const extractor = new FnoDataExtractor(client);
  const protocolId = (args.protocol as string) ?? '';
  const poolId = args.pool as string | undefined;
  const view = await extractor.fnoView({
    protocolId,
    ...(poolId !== undefined ? { poolId } : {}),
  });
  const out = JSON.stringify(view, null, 2);
  if (typeof args.out === 'string') {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(args.out, out);
    console.log(`F&O view written to ${args.out} (endpoint=${view.endpoint}, block=${view.healthBlock})`);
  } else {
    console.log(out);
  }
}

async function cmdDeltas(args: Args): Promise<void> {
  const since = Number(args['since-block'] ?? 0);
  if (!Number.isFinite(since)) throw new Error('--since-block must be a number');
  const reg = registry();
  const client = await reg.firstHealthy();
  const extractor = new FnoDataExtractor(client);
  const deltas = await extractor.deltas(since, args.cursor as string | undefined);
  console.log(JSON.stringify(deltas, null, 2));
}

async function cmdDryRun(args: Args): Promise<void> {
  const chain = ((args.network as string) ?? 'sepolia') as TestnetChain;
  if (!TESTNET_CHAINS.includes(chain)) {
    throw new Error(`--network must be one of: ${TESTNET_CHAINS.join(', ')}`);
  }

  console.log(`== Testnet dry run: ${chain} ==`);
  console.log('Step 1/4 — resolve wallet (optional):');
  const env = loadEnv();
  const signer = new WalletSigner(env);
  try {
    const session = await signer.session(chain);
    console.log(`  wallet mode=${session.mode} address=${session.address} chainId=${session.chainId}`);
  } catch (err) {
    console.log(`  wallet skipped: ${(err as Error).message}`);
  }

  console.log('Step 2/4 — subgraph endpoint health:');
  const reg = registry();
  const refs = reg.list();
  if (refs.length === 0) {
    console.log('  no endpoints configured yet — data extraction steps cannot run.');
    console.log('  Next: deploy perp subgraph (SUBGRAPH_SPEC.md P5) and set STUDIO_PERP_SEPOLIA_ENDPOINT.');
    return;
  }
  const client = await reg.firstHealthy();
  const health = await client.health();
  console.log(`  endpoint=${client.endpointName} block=${health.blockNumber} errors=${health.hasIndexingErrors}`);

  console.log('Step 3/4 — F&O extraction probe:');
  const extractor = new FnoDataExtractor(client);
  const protocolId = (args.protocol as string) ?? '';
  try {
    const snapshot = await extractor.protocolSnapshot(protocolId);
    console.log(`  protocol=${protocolId} found=${snapshot !== null}`);
    if (snapshot) {
      console.log(`  tvl=${snapshot.totalValueLockedUSD} oi=${snapshot.totalOpenInterestUSD}`);
    }
  } catch (err) {
    console.log(`  extraction probe failed (expected until the subgraph is deployed): ${(err as Error).message}`);
  }

  console.log('Step 4/4 — smoke deltas:');
  const deltas = await extractor.deltas(health.blockNumber - 100);
  console.log(`  swaps=${deltas.swaps.length} liquidates=${deltas.liquidates.length}`);
  console.log('Dry run complete.');
}

async function cmdWalletStatus(args: Args): Promise<void> {
  const chain = ((args.network as string) ?? 'sepolia') as TestnetChain;
  const signer = new WalletSigner(loadEnv());
  const session = await signer.session(chain);
  console.log(JSON.stringify({ mode: session.mode, address: session.address, chainId: session.chainId }, null, 2));
}

/**
 * List all configured protocols, optionally filtered by category.
 */
async function cmdListProtocols(args: Args): Promise<void> {
  const env = loadEnv();
  const registry = ProtocolRegistry.fromEnv(env);
  const category = args.category as ProtocolCategory | undefined;

  const refs = category ? registry.getByCategory(category) : registry.list();

  if (refs.length === 0) {
    console.log(category ? `No protocols configured for category: ${category}` : 'No protocols configured.');
    console.log('Set GATEWAY_API_KEY in .env to enable network-tier subgraphs.');
    return;
  }

  console.log(`\n${category ? category.toUpperCase() + ' ' : ''}PROTOCOLS (${refs.length} endpoints)\n`);
  console.log('-'.repeat(80));

  // Group by category for display
  const grouped = new Map<string, typeof refs>();
  for (const ref of refs) {
    const key = ref.category;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(ref);
  }

  for (const [cat, endpoints] of grouped) {
    console.log(`\n[${cat.toUpperCase()}]`);
    for (const ep of endpoints) {
      console.log(`  ${ep.name.padEnd(25)} ${ep.protocol.padEnd(15)} ${ep.network.padEnd(12)} ${ep.tier}`);
    }
  }
  console.log('');
}

/**
 * Test data extraction from a specific category.
 * Validates that we can fetch real data from the subgraphs.
 */
async function cmdTestData(args: Args): Promise<void> {
  const env = loadEnv();
  const registry = ProtocolRegistry.fromEnv(env);
  const category = (args.category as ProtocolCategory) ?? 'lending';

  console.log(`\n=== Testing data extraction: ${category} ===\n`);

  const sources =
    category === 'lending'
      ? registry.getLendingProtocols()
      : category === 'dex'
        ? registry.getDexProtocols()
        : category === 'prediction'
          ? registry.getPredictionProtocols()
          : registry.getPerpetualProtocols();

  if (sources.length === 0) {
    console.log(`No protocols configured for category: ${category}`);
    return;
  }

  for (const source of sources) {
    console.log(`\n--- ${source.protocol} (${source.network}) ---`);
    try {
      // Health check
      const health = await source.client.health({ timeoutMs: 8_000 });
      console.log(`Health: block=${health.blockNumber} errors=${health.hasIndexingErrors}`);

      // Category-specific data test
      if (category === 'lending') {
        const query = `{
          _meta { block { number } }
          reserves(first: 3) {
            symbol
            totalLiquidity
            variableBorrowRate
            liquidityRate
          }
        }`;
        const data: any = await source.client.execute(parse(query), {});
        const reserves = data.reserves ?? [];
        console.log(`  Lending pools: ${reserves.length} reserves found`);
        for (const r of reserves.slice(0, 3)) {
          const totalLiq = Number(r.totalLiquidity) / 1e18;
          const varRate = Number(r.variableBorrowRate) / 1e27;
          console.log(`    ${r.symbol}: totalLiquidity=${totalLiq.toFixed(2)} varBorrowRate=${(varRate * 100).toFixed(2)}%`);
        }
      } else if (category === 'dex') {
        const query = `{
          _meta { block { number } }
          pools(first: 3) {
            token0 { symbol }
            token1 { symbol }
            totalValueLockedUSD
            volumeUSD
          }
        }`;
        const data: any = await source.client.execute(parse(query), {});
        const pools = data.pools ?? [];
        console.log(`  DEX pools: ${pools.length} pools found`);
        for (const p of pools.slice(0, 3)) {
          console.log(`${p.token0?.symbol}/${p.token1?.symbol}: TVL=$${Number(p.totalValueLockedUSD).toFixed(2)} Vol=$${Number(p.volumeUSD).toFixed(2)}`);
        }
      } else if (category === 'prediction') {
        const query = `{
          _meta { block { number } }
          conditions(first: 3) { id }
          redemptions(first: 3, orderBy: payout, orderDirection: desc) {
            payout
            timestamp
          }
          fixedProductMarketMakers(first: 3) { id }
        }`;
        const data: any = await source.client.execute(parse(query), {});
        const conditions = data.conditions ?? [];
        const redemptions = data.redemptions ?? [];
        const fpmm = data.fixedProductMarketMakers ?? [];
        console.log(`  Prediction markets: ${conditions.length} conditions, ${fpmm.length} markets, ${redemptions.length} redemptions`);
        for (const r of redemptions.slice(0, 3)) {
          console.log(`    Redemption: payout=${Number(r.payout) / 1e6} USDC timestamp=${r.timestamp}`);
        }
      }
    } catch (err) {
      console.error(`  ERROR: ${(err as Error).message}`);
    }
  }
  console.log('\n=== Test complete ===\n');
}

async function main(): Promise<void> {
  const { command, args } = parseArgs(process.argv.slice(2));
  switch (command) {
    case 'health':
      return cmdHealth();
    case 'query':
      return cmdQuery(args);
    case 'extract-fno':
      return cmdExtractFno(args);
    case 'deltas':
      return cmdDeltas(args);
    case 'dry-run':
      return cmdDryRun(args);
    case 'wallet-status':
      return cmdWalletStatus(args);
    case 'list-protocols':
      return cmdListProtocols(args);
    case 'test-data':
      return cmdTestData(args);
    default:
      console.log(
        'graph-fno — commands: health | query <file> | extract-fno [--protocol 0x..] [--pool 0x..] [--out f.json] | deltas --since-block N | dry-run --network sepolia | wallet-status | list-protocols [--category lending|dex|prediction|perpetual] | test-data --category <cat>',
      );
  }
}

main().catch((err) => {
  console.error(`error: ${(err as Error).message}`);
  process.exit(1);
});

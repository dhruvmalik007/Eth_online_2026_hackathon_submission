/**
 * The end-to-end order workflow, headless.
 *
 * Three orders, three venues, one process — Aave v3, Morpho, Polymarket — each a real Polygon
 * transaction signed by the service's bound signer and broadcast through `/intents/:id/submit`. No
 * GUI, no browser, nothing that needs a person at the keyboard.
 *
 * Everything it observes is written to `workflow-manifest.json`: every hash, every explorer link, and
 * the cross-chain pair from the bridge. That file is the demo's source of truth — the reference links
 * in it are the ones to open beside the app, and they resolve to real state on real explorers.
 *
 *     pnpm --filter @ethonline2026/bridges exec tsx scripts/workflow.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { encodeFunctionData, parseAbi, parseUnits } from "viem";

const ROOT = "/Users/renu_malik/Desktop/coding_projects/personal_projects/Eth_online_2026_hackathon_submission";
const SERVICE = "https://ethonline-2026-execution.vercel.app";
const SIGNER = "0x63185C0f059dE46DBeEa6813ab461A8863E40e21";

const POLYGON = 137;
const USDC = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";
const PUSDC = "0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB";

// Venues.
const AAVE_V3_POOL = "0x794a61358D6845594F94dc1DB02A252b5b4814aD";
const MORPHO_VAULT = "0xF2532428472a4CbDF27f20Ca39E81DA6DEb420b5"; // MEV Capital USDC Vault
const CTF = "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045"; // Conditional Tokens Framework

// A live market: "Will there be no change in Fed interest rates…"
const CONDITION_ID = "0xa3b36b2d6104d34af4e6c6215fc818e43352e78a748fbfb0b85e3a35f71dec9a" as const;
const PARENT_COLLECTION_ID = `0x${"0".repeat(64)}` as const;

const EXPLORERS = {
  137: "https://polygonscan.com",
  8453: "https://basescan.org",
} as const;

interface Step {
  readonly order: string;
  readonly venue: string;
  readonly label: string;
  readonly call: { chainId: number; to: string; data: string; value: string };
  readonly note?: string;
}

const steps: Step[] = [
  // ── Aave v3 ─────────────────────────────────────────────────────────────────
  {
    order: "1", venue: "Aave v3", label: "approve USDC to the Pool",
    call: {
      chainId: POLYGON, to: USDC, value: "0",
      data: encodeFunctionData({
        abi: parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]),
        functionName: "approve", args: [AAVE_V3_POOL as `0x${string}`, parseUnits("0.02", 6)],
      }),
    },
  },
  {
    order: "1", venue: "Aave v3", label: "supply USDC (collateral position)",
    call: {
      chainId: POLYGON, to: AAVE_V3_POOL, value: "0",
      data: encodeFunctionData({
        abi: parseAbi(["function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)"]),
        functionName: "supply",
        args: [USDC as `0x${string}`, parseUnits("0.02", 6), SIGNER as `0x${string}`, 0],
      }),
    },
    note: "Aave pulls with transferFrom, so the approval above must mine first.",
  },

  // ── Morpho (ERC-4626 vault) ─────────────────────────────────────────────────
  {
    order: "2", venue: "Morpho", label: "approve USDC to the vault",
    call: {
      chainId: POLYGON, to: USDC, value: "0",
      data: encodeFunctionData({
        abi: parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]),
        functionName: "approve", args: [MORPHO_VAULT as `0x${string}`, parseUnits("0.015", 6)],
      }),
    },
  },
  {
    order: "2", venue: "Morpho", label: "deposit USDC into the vault",
    call: {
      chainId: POLYGON, to: MORPHO_VAULT, value: "0",
      data: encodeFunctionData({
        abi: parseAbi(["function deposit(uint256 assets, address receiver) returns (uint256 shares)"]),
        functionName: "deposit", args: [parseUnits("0.015", 6), SIGNER as `0x${string}`],
      }),
    },
    note: "ERC-4626: shares are minted to the receiver; the vault is MEV Capital USDC.",
  },

  // ── Polymarket ──────────────────────────────────────────────────────────────
  {
    order: "3", venue: "Polymarket", label: "approve pUSDC to the CTF",
    call: {
      chainId: POLYGON, to: PUSDC, value: "0",
      data: encodeFunctionData({
        abi: parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]),
        functionName: "approve", args: [CTF as `0x${string}`, parseUnits("2", 6)],
      }),
    },
  },
  {
    order: "3", venue: "Polymarket", label: "splitPosition (take a two-sided position)",
    call: {
      chainId: POLYGON, to: CTF, value: "0",
      data: encodeFunctionData({
        abi: parseAbi([
          "function splitPosition(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] partition, uint256 amount)",
        ]),
        functionName: "splitPosition",
        args: [
          PUSDC as `0x${string}`,
          PARENT_COLLECTION_ID,
          CONDITION_ID as `0x${string}`,
          // [1, 2] is the binary partition: YES and NO. Splitting collateral mints both, which is the
          // on-chain primitive a bid settles against.
          [BigInt(1), BigInt(2)],
          parseUnits("1", 6),
        ],
      }),
    },
    note: "Mints one YES and one NO outcome token per unit of collateral against a live market.",
  },
];

const auth = {
  authorization: `Bearer ${readFileSync(`${process.env.COMMANDCODE_SCRATCHPAD}/privy-access-token.txt`, "utf8").trim()}`,
  "content-type": "application/json",
};

interface Recorded {
  order: string;
  venue: string;
  label: string;
  status: number;
  txHash: string | null;
  explorer: string | null;
  error?: string;
  note?: string;
}

async function submit(step: Step): Promise<Recorded> {
  const response = await fetch(`${SERVICE}/intents/${randomUUID()}/submit`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ calls: [step.call], approvedBy: "workflow@agentic-ems" }),
  });
  const body = (await response.json()) as {
    submitted?: { transactionHash: string }[];
    error?: { message?: string };
  };
  const txHash = body.submitted?.[0]?.transactionHash ?? null;
  const explorer = txHash === null ? null : `${EXPLORERS[POLYGON]}/tx/${txHash}`;
  const out: Recorded = {
    order: step.order,
    venue: step.venue,
    label: step.label,
    status: response.status,
    txHash,
    explorer,
    ...(body.error?.message === undefined ? {} : { error: body.error.message }),
    ...(step.note === undefined ? {} : { note: step.note }),
  };
  console.log(`  [${step.order}] ${step.venue} · ${step.label}`);
  console.log(`       ${response.status} ${txHash ?? JSON.stringify(body).slice(0, 140)}`);
  return out;
}

async function main() {
  console.log(`workflow · signer ${SIGNER}\n`);
  const recorded: Recorded[] = [];
  for (const step of steps) {
    // Sequential, with a pause between the legs of one venue: the service sends without waiting for a
    // receipt, so two calls in flight together share a nonce and fail as a pair.
    recorded.push(await submit(step));
    await new Promise((resolve) => setTimeout(resolve, 9_000));
  }

  // The bridge pair, read back from the desk rather than re-derived here.
  let bridges: unknown = null;
  try {
    const response = await fetch(`${SERVICE}/bridges`, { headers: auth });
    bridges = await response.json();
  } catch (error) {
    bridges = { error: (error as Error).message };
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    signer: SIGNER,
    service: SERVICE,
    chain: { id: POLYGON, name: "Polygon", explorer: EXPLORERS[POLYGON] },
    venues: {
      aave: { pool: AAVE_V3_POOL, docs: "https://aave.com" },
      morpho: { vault: MORPHO_VAULT, docs: "https://app.morpho.org" },
      polymarket: { ctf: CTF, conditionId: CONDITION_ID, docs: "https://polymarket.com" },
    },
    orders: recorded,
    bridgeProgress: bridges,
  };

  const out = `${ROOT}/apps/agentic-ems/workflow-manifest.json`;
  writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`\nmanifest → ${out}`);
  console.log(`  orders: ${recorded.filter((r) => r.txHash !== null).length}/${recorded.length} broadcast`);
}

void main();

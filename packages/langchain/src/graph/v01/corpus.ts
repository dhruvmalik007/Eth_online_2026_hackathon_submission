import type { ProtocolRuleDoc } from './schemas.js';

/**
 * Category A corpus — curated protocol rule documents (hand-verified).
 * Coverage grows per sector; missing sectors route to
 * `constraints_unavailable` in the graph, never guessed rules.
 */

export const PROTOCOL_RULE_CORPUS: readonly ProtocolRuleDoc[] = [
  {
    sector: 'lending',
    protocol: 'aave-v3',
    text: `Aave V3 lending market rules.
- Loan-to-Value: each reserve has a max LTV (e.g. 0.80 for WETH, 0.87 for stables); borrowing above LTV is rejected.
- Liquidation threshold: positions whose health factor falls below 1 are liquidatable; the threshold sits above the max LTV (e.g. 0.85).
- Rate modes: variable and stable rates are offered; stable-rate borrowing can be switched to variable but not always the reverse.
- Supplying capital earns the liquidityRate (RAY-scaled); withdrawing supplied capital is instant (no lockup) as long as utilization < 100%.`,
    source: 'docs/protocols/aave-v3.md',
  },
  {
    sector: 'liquidity',
    protocol: 'uniswap-v4',
    text: `Uniswap v4 pool rules.
- Fee tiers: 0.01%, 0.05%, 0.30%, 1.00%; feeTier 8388608 (0x800000) is the dynamic-fee flag set by the hook at runtime.
- Liquidity positions are in-range only: if price exits the tick range, zero fees accumulate until price re-enters.
- Hooks: pool behavior (fee, LP position management) can be governed by a hook contract; hook restrictions override default pool rules.
- Withdrawing liquidity is instant — no lockup, but pending fees must be collected separately.`,
    source: 'docs/protocols/uniswap-v4.md',
  },
  {
    sector: 'staking',
    protocol: 'rocket-pool',
    text: `Rocket Pool staking rules.
- rETH staking: deposit ETH, receive rETH; the rETH/ETH exchange rate only rises (rewards accrue to the token).
- Unbonding: to exit, rETH is swapped for ETH subject to pool liquidity; during queue periods capital is locked (up to 168 hours under heavy exit load).
- Slashing: underlying validators can be slashed; slashing losses socialize to rETH holders via the exchange rate.
- No fixed term — capital is liquid in principle but exit liquidity is the practical constraint.`,
    source: 'docs/protocols/rocket-pool.md',
  },
  {
    sector: 'lending',
    protocol: 'morpho',
    text: `Morpho Blue rules.
- Markets are isolated single-collateral/single-loan pairs with their own LTV and liquidation threshold parameters.
- Supplying earns interest from borrowers at the market's utilization curve; withdrawal is instant while liquidity remains.
- Rate mode: variable only (no stable rate).
- Bad-debt socialization: oracle failure or bad debt distributes losses pro-rata to suppliers of that market.`,
    source: 'docs/protocols/morpho.md',
  },
];

export function loadProtocolRules(protocols: readonly string[]): ProtocolRuleDoc[] {
  const wanted = new Set(protocols.map((p) => p.toLowerCase()));
  const matched = PROTOCOL_RULE_CORPUS.filter((d) =>
    wanted.has(d.protocol.toLowerCase()),
  );
  return matched;
}

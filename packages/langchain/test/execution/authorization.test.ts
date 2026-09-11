import { describe, expect, it } from 'vitest';
import { authorizeExecution, backtestPasses } from '../../src/execution/authorization.js';

const goodScore = { hitRate: 0.85, mape: 0.12, pnlVsHodl: 1.4 };
const decisions = [
  { action: 'WITHDRAW_LIQUIDITY', protocol: 'uniswap-v4', amountPercentage: 65, citations: ['proj-0xpool-apy', 'c-aave-v3-0-ltv'] },
  { action: 'SUPPLY_CAPITAL', protocol: 'morpho', amountPercentage: 35, citations: ['proj-0xpool-apy'] },
];

describe('backtestPasses (gate)', () => {
  it('accepts scores above both thresholds', () => {
    expect(backtestPasses({ hitRate: 0.7, mape: 0.25 })).toBe(true);
  });
  it('rejects on either threshold', () => {
    expect(backtestPasses({ hitRate: 0.69, mape: 0.1 })).toBe(false);
    expect(backtestPasses({ hitRate: 0.9, mape: 0.26 })).toBe(false);
  });
});

describe('authorizeExecution', () => {
  it('authorizes scoped, capped, session-bounded approvals in dry mode', () => {
    const auth = authorizeExecution({
      mode: 'dry',
      portfolioUsd: 1_000_000,
      sessionExpiresAt: 1_800_000_000,
      decisions,
      backtestScore: goodScore,
    });
    expect(auth.approved).toBe(true);
    expect(auth.mode).toBe('dry');
    expect(auth.scopes).toHaveLength(2);
    expect(auth.scopes[0]!.notionalUsdCap).toBe(650_000); // 65% of 1M
    expect(auth.scopes[0]!.expiresAt).toBe(1_800_000_000);
  });

  it('rejects a proposal without backtest evidence', () => {
    const auth = authorizeExecution({
      mode: 'dry',
      portfolioUsd: 1_000_000,
      sessionExpiresAt: 1_800_000_000,
      decisions,
      backtestScore: { hitRate: 0.5, mape: 0.4, pnlVsHodl: 0.5 },
    });
    expect(auth.approved).toBe(false);
    expect(auth.rejectedReasons.join(' ')).toContain('backtest gate failed');
    expect(auth.scopes).toHaveLength(0);
  });

  it('rejects unbalanced allocations', () => {
    const auth = authorizeExecution({
      mode: 'dry',
      portfolioUsd: 1_000_000,
      sessionExpiresAt: 1_800_000_000,
      decisions: [decisions[0]!],
      backtestScore: goodScore,
    });
    expect(auth.approved).toBe(false);
    expect(auth.rejectedReasons.join(' ')).toContain('sum to');
  });

  it('rejects uncited decisions (hallucination guard)', () => {
    const auth = authorizeExecution({
      mode: 'dry',
      portfolioUsd: 1_000_000,
      sessionExpiresAt: 1_800_000_000,
      decisions: [{ ...decisions[0]!, citations: [] }, decisions[1]!],
      backtestScore: goodScore,
    });
    expect(auth.approved).toBe(false);
    expect(auth.rejectedReasons.join(' ')).toContain('uncited');
  });

  it('rejects unknown actions (no raw calldata, no invented verbs)', () => {
    const auth = authorizeExecution({
      mode: 'dry',
      portfolioUsd: 1_000_000,
      sessionExpiresAt: 1_800_000_000,
      decisions: [
        { action: 'SWAP_ALL', protocol: 'x', amountPercentage: 100, citations: ['proj-0xpool-apy'] },
      ],
      backtestScore: goodScore,
    });
    expect(auth.approved).toBe(false);
    expect(auth.rejectedReasons.join(' ')).toContain('unknown action');
  });
});

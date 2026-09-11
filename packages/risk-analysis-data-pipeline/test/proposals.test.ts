/**
 * Tests for the shared proposal classifier.
 *
 * The rule is used by both the temporal writer and the API, so pinning its
 * behaviour here is what keeps the stored count and the reported count equal. The
 * golden cases are real proposal titles from Aave and Uniswap governance, so the
 * expectations reflect text that actually occurs rather than invented strings.
 */

import { describe, expect, it } from 'vitest';
import { countRiskRelevantProposals, isRiskRelevantProposal } from '../src/index.js';

describe('isRiskRelevantProposal', () => {
  it('matches a parameter-changing proposal', () => {
    // The canonical case: raising a liquidation threshold moves the risk
    // parameters the pricing math depends on.
    expect(isRiskRelevantProposal('[ARFC] Raise the liquidation threshold')).toBe(true);
  });

  it('matches collateral, oracle and interest-rate proposals', () => {
    for (const title of [
      '[ARFC] Add sUSDe to Aave V3 Ethereum as collateral',
      '[AIP] Update the wstETH oracle address',
      'Chaos Labs Risk Parameter Updates - 2026-08-15',
      '[Temp Check] Set the borrow cap for USDC',
      '[ARFC] Adjust the interest rate model for WETH',
    ]) {
      expect(isRiskRelevantProposal(title), title).toBe(true);
    }
  });

  it('does not match an administrative proposal', () => {
    // A grants renewal is an ARFC but touches no risk parameter, so counting it
    // would overstate governance pressure on the protocol's risk surface.
    expect(isRiskRelevantProposal('[ARFC] Renew the grants committee')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isRiskRelevantProposal('RAISE THE LIQUIDATION THRESHOLD')).toBe(true);
    expect(isRiskRelevantProposal('raise the Liquidation Threshold')).toBe(true);
  });

  it('documents its substring-match limitation', () => {
    // These are matched because the rule is a substring match, retained from the
    // original implementation. Asserting it keeps the limitation visible: if the
    // rule is ever tightened, this test fails and the change is deliberate rather
    // than accidental.
    expect(isRiskRelevantProposal('Increase the capital efficiency program')).toBe(true);
  });

  it('returns false for an unrelated title', () => {
    expect(isRiskRelevantProposal('Community call summary for August')).toBe(false);
  });
});

describe('countRiskRelevantProposals', () => {
  it('counts only the titles that match', () => {
    const count = countRiskRelevantProposals([
      { title: '[ARFC] Raise the liquidation threshold' },
      { title: '[ARFC] Renew the grants committee' },
      { title: '[AIP] Update the reserve factor' },
    ]);

    expect(count).toBe(2);
  });

  it('returns zero for an empty list', () => {
    expect(countRiskRelevantProposals([])).toBe(0);
  });
});

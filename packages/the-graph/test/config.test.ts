import { describe, expect, it } from 'vitest';
import { CHAIN_INFO, TESTNET_CHAINS, loadEnv, networkEndpoint } from '../src/config/index.js';

describe('config', () => {
  it('exposes the five Studio-deployable testnets', () => {
    expect(TESTNET_CHAINS).toEqual([
      'sepolia',
      'arbitrum-sepolia',
      'base-sepolia',
      'optimism-sepolia',
      'polygon-amoy',
    ]);
  });

  it('builds gateway network endpoints deterministically', () => {
    expect(networkEndpoint('5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV')).toBe(
      'https://gateway.thegraph.com/api/subgraphs/id/5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV',
    );
  });

  it('maps chain ids correctly', () => {
    expect(CHAIN_INFO.sepolia.id).toBe(11155111);
    expect(CHAIN_INFO['arbitrum-sepolia'].id).toBe(421614);
    expect(CHAIN_INFO['base-sepolia'].id).toBe(84532);
    expect(CHAIN_INFO['optimism-sepolia'].id).toBe(11155420);
    expect(CHAIN_INFO['polygon-amoy'].id).toBe(80002);
  });

  it('rejects a bad wallet address shape', () => {
    const prev = process.env.WALLET_ADDRESS;
    process.env.WALLET_ADDRESS = 'not-an-address';
    expect(() => loadEnv()).toThrow(/Invalid environment/);
    if (prev !== undefined) process.env.WALLET_ADDRESS = prev;
    else delete process.env.WALLET_ADDRESS;
  });
});

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

  it('routes polygon-amoy to its own viem chain and RPC env key (never Sepolia)', () => {
    expect(CHAIN_INFO['polygon-amoy'].viemChain).toBe('polygonAmoy');
    expect(CHAIN_INFO['polygon-amoy'].rpcEnvKey).toBe('RPC_URL_POLYGON_AMOY');
    // Each chain owns a distinct rpcEnvKey — no silent cross-chain reuse.
    const keys = TESTNET_CHAINS.map((c) => CHAIN_INFO[c].rpcEnvKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('defaults RPC_URL_POLYGON_AMOY to the official Polygon public RPC', () => {
    const prev = process.env.RPC_URL_POLYGON_AMOY;
    delete process.env.RPC_URL_POLYGON_AMOY;
    const env = loadEnv();
    expect(env.RPC_URL_POLYGON_AMOY).toBe('https://polygon-amoy.drpc.org');
    if (prev !== undefined) process.env.RPC_URL_POLYGON_AMOY = prev;
  });

  it('rejects a bad wallet address shape', () => {
    const prev = process.env.WALLET_ADDRESS;
    process.env.WALLET_ADDRESS = 'not-an-address';
    expect(() => loadEnv()).toThrow(/Invalid environment/);
    if (prev !== undefined) process.env.WALLET_ADDRESS = prev;
    else delete process.env.WALLET_ADDRESS;
  });
});

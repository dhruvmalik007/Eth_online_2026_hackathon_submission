import { GraphQLClient } from 'graphql-request';
import type { Env, TestnetChain } from './env.js';

/**
 * Endpoint registry. Three tiers, verified 2026-09-07:
 *
 *  studio   — your own testnet subgraphs on Subgraph Studio (free tier, 3k q/day dev URL)
 *  network  — decentralized-network curated deployments via gateway.thegraph.com (needs GATEWAY_API_KEY)
 *
 * Supports multi-category DeFi data: Lending, Perpetuals, DEX, Prediction Markets
 */

export const STUDIO_BASE = 'https://api.studio.thegraph.com/query';

/** Well-known network-tier deployments (verified 2026-09-07). */
export const KNOWN_DEPLOYMENTS = {
  // --- Lending ---
  aaveV3Ethereum: 'Cd2gEDVeqnjBn1hSeqFMitw8Q1iiyV9FYUZkLNRcL87g',
  aaveV3Arbitrum: 'DLuE98kEb5pQNXAcKFQGQgfSQ57Xdou4jnVbAEqMfy3B',
  aaveV3Optimism: 'DSfLz8oQBUeU5atALgUFQKMTSYV9mZAVYp4noLSXAfvb',
  aaveV3Base: 'GQFbb95cE6d8mV989mL5figjaKaKCQB3xqYrr1bRyXqF',
  aaveV3Polygon: 'Co2URyXjnxaw8WqxKyVHdirqAhm5vcTs4dMedAq211',
  aaveV3Avalanche: '2h9woxy8RTjHu1HJsCEnmzpPHFArU33avmUh4f71JpVn',
  aaveV2Ethereum: '8wR23o1zkS4gpLqLNU4kG3JHYVucqGyopL5utGxP2q1N',

  // --- DEX ---
  uniswapV3: '5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV',

  // --- Prediction Markets ---
  polymarketActivity: 'Bx1W4S7kDVxs9gC3s2G6DS8kdNBJNVhMviCtin2DiBp',
  polymarketMain: '81Dm16JjuFSrqz813HysXoUPvzTwE7fsfPk2RTf66nyC',

  // --- Perpetuals (Messari) ---
  // Note: GMX, dYdX subgraph IDs need to be fetched from Messari deployment.json
} as const;

export type DeploymentKey = keyof typeof KNOWN_DEPLOYMENTS;

export interface EndpointRef {
  readonly name: string;
  readonly url: string;
  readonly tier: 'studio' | 'network';
  readonly requiresAuth: boolean;
  readonly category: 'lending' | 'perpetual' | 'dex' | 'prediction';
  readonly protocol: string;
  readonly network: string;
}

/**
 * Build a gateway.thegraph.com URL for a subgraph ID.
 * GATEWAY_API_KEY is injected into the Authorization header, not the URL.
 */
export function networkEndpoint(subgraphId: string): string {
  return `https://gateway.thegraph.com/api/subgraphs/id/${subgraphId}`;
}

export function studioEndpoint(env: Env, chain: TestnetChain): string {
  switch (chain) {
    case 'sepolia':
      if (!env.STUDIO_PERP_SEPOLIA_ENDPOINT) {
        throw new Error('STUDIO_PERP_SEPOLIA_ENDPOINT not set — deploy the perp subgraph first (SUBGRAPH_SPEC.md P5) or set the env var.');
      }
      return env.STUDIO_PERP_SEPOLIA_ENDPOINT;
    default:
      throw new Error(`No Studio endpoint registered for ${chain} yet. Add it to src/config/env.ts + .env.`);
  }
}

/**
 * Resolve all configured endpoints from environment.
 * Categorized by DeFi protocol type for the fixed income EMS.
 */
export function resolveEndpoints(env: Env): EndpointRef[] {
  const refs: EndpointRef[] = [];

  // Studio tier (own deployments)
  if (env.STUDIO_PERP_SEPOLIA_ENDPOINT) {
    refs.push({
      name: 'emsPerpSepolia',
      url: env.STUDIO_PERP_SEPOLIA_ENDPOINT,
      tier: 'studio',
      requiresAuth: false,
      category: 'perpetual',
      protocol: 'custom-perp',
      network: 'sepolia',
    });
  }

  // Network tier (decentralized subgraphs) — requires GATEWAY_API_KEY
  if (env.GATEWAY_API_KEY) {
    // --- Lending ---
    refs.push({
      name: 'aaveV3Ethereum',
      url: networkEndpoint(KNOWN_DEPLOYMENTS.aaveV3Ethereum),
      tier: 'network',
      requiresAuth: true,
      category: 'lending',
      protocol: 'aave-v3',
      network: 'ethereum',
    });
    refs.push({
      name: 'aaveV3Arbitrum',
      url: networkEndpoint(KNOWN_DEPLOYMENTS.aaveV3Arbitrum),
      tier: 'network',
      requiresAuth: true,
      category: 'lending',
      protocol: 'aave-v3',
      network: 'arbitrum',
    });
    refs.push({
      name: 'aaveV3Optimism',
      url: networkEndpoint(KNOWN_DEPLOYMENTS.aaveV3Optimism),
      tier: 'network',
      requiresAuth: true,
      category: 'lending',
      protocol: 'aave-v3',
      network: 'optimism',
    });
    // NOTE: Base subgraph ID needs to be fetched from Aave's decentralized network deployment
    // The ID below is for the deprecated hosted service — needs updating
    // refs.push({
    //   name: 'aaveV3Base',
    //   url: networkEndpoint(KNOWN_DEPLOYMENTS.aaveV3Base),
    //   tier: 'network',
    //   requiresAuth: true,
    //   category: 'lending',
    //   protocol: 'aave-v3',
    //   network: 'base',
    // });

    // --- DEX ---
    refs.push({
      name: 'uniswapV3',
      url: networkEndpoint(KNOWN_DEPLOYMENTS.uniswapV3),
      tier: 'network',
      requiresAuth: true,
      category: 'dex',
      protocol: 'uniswap-v3',
      network: 'ethereum',
    });

    // --- Prediction Markets ---
    refs.push({
      name: 'polymarketActivity',
      url: networkEndpoint(KNOWN_DEPLOYMENTS.polymarketActivity),
      tier: 'network',
      requiresAuth: true,
      category: 'prediction',
      protocol: 'polymarket',
      network: 'polygon',
    });
  }

  return refs;
}

/**
 * Filter endpoints by category.
 */
export function getEndpointsByCategory(refs: EndpointRef[], category: EndpointRef['category']): EndpointRef[] {
  return refs.filter((r) => r.category === category);
}

/**
 * Filter endpoints by protocol.
 */
export function getEndpointsByProtocol(refs: EndpointRef[], protocol: string): EndpointRef[] {
  return refs.filter((r) => r.protocol === protocol);
}

export function makeClient(endpoint: EndpointRef, env: Env): GraphQLClient {
  return new GraphQLClient(endpoint.url, {
    headers: endpoint.requiresAuth
      ? { authorization: `Bearer ${env.GATEWAY_API_KEY}` }
      : {},
  });
}

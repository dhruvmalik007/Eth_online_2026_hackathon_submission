import type { SubgraphClient } from '../clients/SubgraphClient.js';
import type { FnoView } from './FnoView.js';
import type {
  DeltaRow,
  FundingSnapshot,
  PositionRow,
  ProtocolSnapshot,
  TokenFdvRow,
} from '../queries/fno/schemas.js';
import {
  fnoDeltas,
  fnoFdvTokens,
  fnoFunding,
  fnoOpenPositions,
  fnoProtocolSnapshot,
} from '../queries/index.js';

export type {
  FinancialMetric,
  FundingSnapshot,
  HourlySnapshot,
  PositionRow,
  ProtocolSnapshot,
  TokenFdvRow,
  DeltaRow,
} from '../queries/fno/schemas.js';
export type { FnoView } from './FnoView.js';

/**
 * F&O data extraction per the Messari Derivatives Perpetual Futures schema v1.3.4.
 * All queries run through QueryDefinition templates (variables validated before
 * send, responses validated after receive) — the EMS risk engine and dashboard
 * consume these shapes, so schema drift fails loudly at the validation boundary.
 *
 * Public method signatures are unchanged from the pre-template API.
 */
export class FnoDataExtractor {
  constructor(private readonly client: SubgraphClient) {}

  async protocolSnapshot(protocolId: string): Promise<ProtocolSnapshot | null> {
    const data = await this.client.executeTemplate(fnoProtocolSnapshot, { protocol: protocolId });
    return data.derivPerpProtocol;
  }

  async funding(poolId: string, hours = 24): Promise<FundingSnapshot | null> {
    const data = await this.client.executeTemplate(fnoFunding, { pool: poolId, hours });
    return data.liquidityPool;
  }

  async openPositions(poolId: string, pageSize = 1000): Promise<PositionRow[]> {
    const data = await this.client.collectAll(fnoOpenPositions, {
      pageSize,
      extraVars: { pool: poolId },
    });
    return data.positions;
  }

  async fdvTokens(pageSize = 500): Promise<TokenFdvRow[]> {
    const data = await this.client.collectAll(fnoFdvTokens, { pageSize });
    return data.tokens;
  }

  /** Incremental delta pull since last seen block — the poller's hot path (cost-controlled). */
  async deltas(
    lastBlock: number,
    lastId?: string,
    pageSize = 500,
  ): Promise<{ swaps: DeltaRow[]; liquidates: DeltaRow[] }> {
    const data = await this.client.executeTemplate(fnoDeltas, {
      lastBlock,
      lastID: lastId,
      first: pageSize,
    });
    return { swaps: data.swaps, liquidates: data.liquidates };
  }

  /** One-shot aggregate: health + protocol + funding + positions + FDV. */
  async fnoView(input: {
    protocolId: string;
    poolId?: string;
    fundingHours?: number;
  }): Promise<FnoView> {
    const health = await this.client.health();
    const [protocol, funding, openPositions, fdvTokens] = await Promise.all([
      this.protocolSnapshot(input.protocolId),
      input.poolId !== undefined ? this.funding(input.poolId, input.fundingHours ?? 24) : Promise.resolve(null),
      input.poolId !== undefined ? this.openPositions(input.poolId) : Promise.resolve([]),
      this.fdvTokens(),
    ]);

    return {
      endpoint: this.client.endpointName,
      healthBlock: health.blockNumber,
      protocol,
      funding,
      openPositions,
      fdvTokens,
    };
  }
}

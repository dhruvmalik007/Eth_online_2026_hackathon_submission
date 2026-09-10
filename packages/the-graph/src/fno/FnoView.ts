import type {
  FundingSnapshot,
  PositionRow,
  ProtocolSnapshot,
  TokenFdvRow,
} from '../queries/fno/schemas.js';

/** Aggregate F&O view — what the EMS risk engine + dashboard consume in one call. */
export interface FnoView {
  readonly endpoint: string;
  readonly healthBlock: number;
  readonly protocol: ProtocolSnapshot | null;
  readonly funding: FundingSnapshot | null;
  readonly openPositions: PositionRow[];
  readonly fdvTokens: TokenFdvRow[];
}

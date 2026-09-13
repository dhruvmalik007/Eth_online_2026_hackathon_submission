/**
 * Reading real execution state from the deployed execution service.
 *
 * The desk's execution surface was built against a simulated adapter, and the demo stage rendered
 * **fabricated transaction hashes** — five invented `0x…` strings per agent. A hash is a claim
 * about an on-chain fact that a reviewer can paste into an explorer, so those were removed. This
 * is what replaces them: the service's own recorded steps, which carry a real `tx_hash` for a
 * same-chain call and, for a cross-chain one, the `src_tx_hash` / `dst_tx_hash` / `guid` triple.
 *
 * Three deliberate properties:
 *
 *   - **Absent is a state, not an error.** A step recorded in `dry` mode has no hash, and that is
 *     the correct answer rather than a gap to fill. Every mapper below returns `undefined` rather
 *     than a placeholder, so a caller cannot accidentally render an empty link.
 *   - **The three stages stay distinct.** A source transaction succeeding says nothing about
 *     whether the message was delivered, so `MessageTracking` keeps `src` and `dst` apart and adds
 *     the LayerZero scan URL rather than pretending one hash covers the bridge.
 *   - **No explorer URL is invented.** Links come from `CHAIN_META` (which derives them from viem),
 *     and a chain id the app does not know yields no link at all instead of a guessed one.
 */
import { CHAIN_META, explorerTxUrl, scanUrl } from "./chains";
import type { ChainKey, MessageTracking } from "./types";

/** One recorded step, as the execution service returns it (`exec_steps`). */
export interface RecordedStep {
  readonly stepId: string;
  readonly intentId: string;
  readonly seq: number;
  readonly kind: string;
  readonly label: string;
  readonly status: string;
  readonly chainId: number;
  readonly txHash: string | null;
  readonly srcTxHash: string | null;
  readonly dstTxHash: string | null;
  readonly guid: string | null;
  readonly error: string | null;
}

/** `chainId` → `ChainKey`, derived from `CHAIN_META` so the two cannot drift apart. */
const CHAIN_BY_ID: ReadonlyMap<number, ChainKey> = new Map(
  (Object.entries(CHAIN_META) as [ChainKey, { chainId: number }][]).map(([key, meta]) => [
    meta.chainId,
    key,
  ]),
);

export function chainKeyForId(chainId: number): ChainKey | undefined {
  return CHAIN_BY_ID.get(chainId);
}

/**
 * The cross-chain tracking a step carries, or `undefined` when it carries none.
 *
 * `undefined` is the important half: it is what lets the UI say "not broadcast" instead of
 * rendering a link to nowhere.
 */
export function toMessageTracking(step: RecordedStep): MessageTracking | undefined {
  const chain = chainKeyForId(step.chainId);
  const tracking: MessageTracking = {};
  let any = false;

  if (step.srcTxHash !== null && step.srcTxHash.length > 0) {
    tracking.srcTxHash = step.srcTxHash;
    if (chain !== undefined) tracking.srcExplorerUrl = explorerTxUrl(chain, step.srcTxHash);
    // The scan URL is keyed on the message guid when there is one, because that is what the
    // tracker resolves; the source hash is only a fallback for a message without one.
    tracking.scanUrl = scanUrl(step.guid ?? step.srcTxHash);
    any = true;
  }
  if (step.guid !== null && step.guid.length > 0) {
    tracking.guid = step.guid;
    any = true;
  }
  if (step.dstTxHash !== null && step.dstTxHash.length > 0) {
    tracking.dstTxHash = step.dstTxHash;
    if (chain !== undefined) tracking.dstExplorerUrl = explorerTxUrl(chain, step.dstTxHash);
    any = true;
  }

  return any ? tracking : undefined;
}

/** The single same-chain hash a step recorded, or `undefined`. */
export function confirmedHash(step: RecordedStep): string | undefined {
  return step.txHash !== null && step.txHash.length > 0 ? step.txHash : undefined;
}

/**
 * Every hash a recorded run actually produced, ready for the dashboard's link list.
 *
 * Steps without a hash are skipped rather than emitted with an empty one — the run's record is a
 * list of things that happened, not a list of slots that should have.
 */
export function hashesFromSteps(
  steps: readonly RecordedStep[],
): { label: string; hash: string; url?: string }[] {
  const out: { label: string; hash: string; url?: string }[] = [];
  for (const step of steps) {
    const chain = chainKeyForId(step.chainId);
    const hash = confirmedHash(step);
    if (hash !== undefined) {
      out.push({
        label: step.label,
        hash,
        ...(chain === undefined ? {} : { url: explorerTxUrl(chain, hash) }),
      });
      continue;
    }
    // A cross-chain leg lands on the destination, so that is the hash worth linking when both
    // exist; the source is already reachable through the scan URL on the tracking row.
    const tracking = toMessageTracking(step);
    if (tracking?.dstTxHash !== undefined) {
      out.push({
        label: step.label,
        hash: tracking.dstTxHash,
        ...(tracking.dstExplorerUrl === undefined ? {} : { url: tracking.dstExplorerUrl }),
      });
    }
  }
  return out;
}

export interface LiveReaderOptions {
  readonly baseUrl: string;
  /** The service's development authenticator reads `x-user-id`. */
  readonly userId: string;
  readonly fetchImpl?: typeof fetch;
}

interface StepsEnvelope {
  readonly count?: number;
  readonly events?: unknown;
  readonly bridges?: unknown;
}

function isRecordedStep(value: unknown): value is RecordedStep {
  if (value === null || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row["stepId"] === "string" && typeof row["kind"] === "string";
}

function readSteps(body: StepsEnvelope, key: "events" | "bridges"): RecordedStep[] {
  const raw = body[key];
  return Array.isArray(raw) ? raw.filter(isRecordedStep) : [];
}

async function getSteps(
  options: LiveReaderOptions,
  path: string,
  key: "events" | "bridges",
): Promise<RecordedStep[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${options.baseUrl.replace(/\/+$/, "")}${path}`, {
    headers: { "x-user-id": options.userId, accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) {
    // Named so the caller can distinguish "the service said no" from "the service is unreachable",
    // which are different things to tell an operator.
    throw new Error(`execution service returned ${response.status} for ${path}`);
  }
  return readSteps((await response.json()) as StepsEnvelope, key);
}

/** In-flight cross-chain messages — the surface that actually has src/dst hashes. */
export function fetchBridgeProgress(options: LiveReaderOptions): Promise<RecordedStep[]> {
  return getSteps(options, "/bridges", "bridges");
}

/** The recorded steps of one run, which carry any confirmed same-chain hashes. */
export function fetchRunEvents(options: LiveReaderOptions, runId: string): Promise<RecordedStep[]> {
  return getSteps(options, `/runs/${encodeURIComponent(runId)}/events`, "events");
}

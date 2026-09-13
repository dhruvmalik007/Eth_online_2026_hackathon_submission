/**
 * The evidence record.
 *
 * ## Why evidence is committed rather than printed
 *
 * A fork run is only reproducible if it records the block it ran against. Every number a
 * scenario observes — a vault's share price, a curve's output, a quote's fee — is a function
 * of the block, so a result without a block is an anecdote. Committing the record is what
 * turns "it worked on my machine" into something a judge can re-run and compare against.
 *
 * ## What is deliberately excluded
 *
 * The RPC URL. Providers put credentials in the path or query string, and a committed file
 * would leak them. Only the host is recorded, which answers the question a reader actually
 * has — was this a real network fork or a private one? — without carrying the key.
 *
 * ## Why the checks carry a `detail` and not just a boolean
 *
 * A failed check that says only `false` forces the reader to re-run the scenario to find out
 * what happened. The detail is written at the moment of the observation, when the actual
 * values are in hand, which is the only time it is free to produce.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

export const CheckSchema = z.object({
  /** Stable identifier, e.g. `code:morpho.blue` — greppable across runs. */
  name: z.string().min(1),
  ok: z.boolean(),
  detail: z.string(),
});

export const TransactionRecordSchema = z.object({
  /** Which step of the scenario produced it. */
  step: z.string().min(1),
  hash: z.string().min(1),
  explorerUrl: z.string().optional(),
});

/**
 * One scenario run against one chain.
 *
 * `schema` is versioned so a later reader can tell an old artifact from a new one instead of
 * silently misreading a field that changed meaning.
 */
export const EvidenceSchema = z.object({
  schema: z.literal("fork-evidence/1"),
  scenario: z.string().min(1),
  chain: z.string().min(1),
  chainId: z.number().int().positive(),
  /** Host only — never the credential-bearing parts of the URL. */
  rpcHost: z.string().min(1),
  /** The block the fork was pinned to, when one was configured. */
  forkBlock: z.number().int().positive().nullable(),
  /** The head the local node actually served, which is the number the results depend on. */
  observedBlockNumber: z.number().int().nonnegative().nullable(),
  generatedAt: z.string().min(1),
  checks: z.array(CheckSchema),
  txs: z.array(TransactionRecordSchema),
});
export type Evidence = z.infer<typeof EvidenceSchema>;
export type Check = z.infer<typeof CheckSchema>;

/** Count how a run went, so a caller can fail a CI job on it. */
export function summarise(checks: readonly Check[]): { readonly passed: number; readonly failed: number } {
  const failed = checks.filter((check) => !check.ok).length;
  return { passed: checks.length - failed, failed };
}

/**
 * Write one evidence file and return its path.
 *
 * The filename carries the chain, the scenario and the fork block, so two runs at different
 * blocks sit side by side rather than overwriting each other — which is exactly the
 * comparison you want when a result looks wrong and you need to know whether the chain moved.
 */
export async function writeEvidence(directory: string, evidence: Evidence): Promise<string> {
  // Validated on the way out, not just on the way in: this is a persisted artifact, and a
  // record that fails its own schema is worse than no record, because it will be trusted.
  const validated = EvidenceSchema.parse(evidence);

  await mkdir(directory, { recursive: true });
  const block = validated.forkBlock ?? validated.observedBlockNumber ?? "head";
  const path = join(directory, `${validated.chain}-${validated.scenario}-${block}.json`);
  await writeFile(path, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
  return path;
}

/** Build a check, so call sites read as the assertion they are making. */
export function check(name: string, ok: boolean, detail: string): Check {
  return { name, ok, detail };
}

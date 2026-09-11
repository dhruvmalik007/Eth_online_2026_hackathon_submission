/**
 * Roster loading — the curated list of what gets scraped.
 *
 * The roster lives in `roster.json` at the package root and is read by *both*
 * this module and the Python worker, which validates it with pydantic. Keeping
 * one file rather than a definition per language removes the class of bug where
 * the scraper collects a protocol the reader has never heard of, or the reverse.
 *
 * Loading is strict: a malformed roster is a configuration error and should fail
 * loudly rather than silently resolve to an empty sweep.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { ValidationError } from './errors.js';

/** Where the roster file lives, relative to this module's build output. */
const ROSTER_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'roster.json');

/** A chain to profile from L2Beat. */
export const ChainTargetSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  l2beatPath: z.string().min(1),
});
export type ChainTarget = z.infer<typeof ChainTargetSchema>;

/**
 * How a protocol's governance was confirmed reachable.
 *
 * `verified` records whether a live probe confirmed the transport, so a reader
 * can tell "not yet checked" apart from "checked and unavailable".
 */
export const PROTOCOL_TRANSPORTS = [
  'discourse-json',
  'html-only',
  'blocked',
  'absent',
  'unknown',
] as const;
export const ProtocolTransportSchema = z.enum(PROTOCOL_TRANSPORTS);
export type ProtocolTransport = z.infer<typeof ProtocolTransportSchema>;

/** A protocol whose governance forum to profile. */
export const ProtocolTargetSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  category: z.enum(['lending', 'dex', 'perps', 'yield', 'stablecoin', 'other']),
  /** Absent when the protocol has no reachable forum. */
  forumUrl: z.string().nullable(),
  transport: ProtocolTransportSchema,
  verified: z.boolean(),
  /** Why a protocol is excluded, when it is. */
  note: z.string().optional(),
});
export type ProtocolTarget = z.infer<typeof ProtocolTargetSchema>;

/** The parsed roster. */
export const RosterSchema = z.object({
  version: z.string().min(1),
  chains: z.array(ChainTargetSchema),
  protocols: z.array(ProtocolTargetSchema),
});
export type Roster = z.infer<typeof RosterSchema>;

/**
 * Load and validate the roster.
 *
 * @param path - Optional override for the roster location.
 * @returns The parsed roster.
 * @throws {ValidationError} When the file is absent or malformed. A bad roster
 *   must stop the caller rather than produce an empty result that looks like a
 *   successful sweep.
 */
export function loadRoster(path?: string): Roster {
  const resolved = path ?? ROSTER_PATH;

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(resolved, 'utf8'));
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new ValidationError('roster', `could not read roster at ${resolved}: ${detail}`, null);
  }

  const parsed = RosterSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ValidationError(
      issue?.path.join('.') ?? 'roster',
      issue?.message ?? 'roster failed validation',
      raw,
    );
  }
  return parsed.data;
}

/**
 * Return the protocols whose governance can actually be fetched.
 *
 * Protocols the capability probe classified as `absent` or `blocked` are
 * excluded, because the roster already records why they are unavailable and
 * retrying them every sweep would spend time to relearn a known answer.
 *
 * @param roster - The roster to filter.
 * @returns The scrapable protocol targets.
 */
export function scrapableProtocols(roster: Roster): ProtocolTarget[] {
  return roster.protocols.filter((p) => p.transport === 'discourse-json');
}

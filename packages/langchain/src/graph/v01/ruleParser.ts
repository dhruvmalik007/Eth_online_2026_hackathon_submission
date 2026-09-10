import { z } from 'zod';
import type { ConstraintSchemaT, ProtocolRuleDoc } from './schemas.js';
import { ConstraintSchema } from './schemas.js';

/**
 * Node 2 — Legal & Rule Parsing (LLM, structured output).
 *
 * Category A text → strict unified ConstraintSchema JSON. Guardrails: zod
 * structured-output with ONE bounded re-ask (validation errors fed back
 * once), per-constraint source provenance, and typed failure — unparseable
 * rules never become guessed constraints.
 */

/** LLM port — pluggable across model families (model registry resolves roles). */
export interface StructuredLlm {
  invoke(input: { system: string; user: string }): Promise<string>;
}

const SYSTEM_PROMPT = `You are a DeFi protocol rule parser for a fixed-income EMS.
Extract machine-readable constraints from the protocol documentation.
Respond ONLY with a JSON array. Each element:
{ "protocol": string, "sector": "staking"|"liquidity"|"lending",
  "kind": "lockup"|"slashing"|"fee"|"ltv"|"liquidation"|"hook"|"rate-mode"|"other",
  "boundary": object (machine-readable, e.g. {"lockupHours":168} or {"ltvMax":0.8}),
  "statement": string (the rule, near-verbatim),
  "source": string (doc reference) }
Never invent rules that are not in the text. If the text is silent on a topic,
emit nothing for it.`;

/** Parse one re-ask round. Throws the zod error for the caller to feed back. */
function parseRound(text: string, protocolFallback: string): ConstraintSchemaT[] {
  const jsonStart = text.indexOf('[');
  const jsonEnd = text.lastIndexOf(']');
  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error('rule parser response contains no JSON array');
  }
  const parsed: unknown = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
  const arr = z.array(z.record(z.string(), z.unknown())).parse(parsed);
  return arr.map((raw, i) =>
    ConstraintSchema.parse({
      id: `c-${protocolFallback}-${i}-${String(raw['kind'] ?? 'other')}`,
      protocol: raw['protocol'] ?? protocolFallback,
      sector: raw['sector'],
      kind: raw['kind'],
      boundary: raw['boundary'],
      statement: raw['statement'],
      source: raw['source'],
    }),
  );
}

export async function parseProtocolRules(input: {
  docs: readonly ProtocolRuleDoc[];
  llm: StructuredLlm;
}): Promise<ConstraintSchemaT[]> {
  const user = input.docs
    .map((d) => `## ${d.protocol} (${d.sector}) — source: ${d.source}\n${d.text}`)
    .join('\n\n');

  const first = await input.llm.invoke({ system: SYSTEM_PROMPT, user });
  let parsed: ConstraintSchemaT[];
  try {
    parsed = parseRound(first, input.docs[0]?.protocol ?? 'unknown');
  } catch (err) {
    // ONE bounded re-ask with the validation errors fed back (never loop).
    const retry = await input.llm.invoke({
      system: SYSTEM_PROMPT,
      user: `${user}\n\nYour previous response failed validation:\n${(err as Error).message}\n\nRespond again with a strictly valid JSON array.`,
    });
    parsed = parseRound(retry, input.docs[0]?.protocol ?? 'unknown');
  }
  return parsed;
}

import { describe, expect, it } from 'vitest';

import { probeTimesfm3 } from '../api/_lib/runtime.js';

/**
 * A fetch that reports what it was handed rather than pretending to be one.
 *
 * Simulating the abort would be a test of the simulation: `AbortSignal.timeout` is a platform
 * primitive, and a fake that fires it on a timer verifies the fake, not the probe. What is worth
 * asserting is that the signal reaches the fetch implementation at all — an unbounded probe is
 * exactly the absence of one — and that a timeout is translated into something a reader can act on.
 */
const reporting = (captured: { signal: AbortSignal | null | undefined }) =>
  (async (_input: unknown, init?: { signal?: AbortSignal | null }) => {
    captured.signal = init?.signal;
    throw Object.assign(new Error('The operation was aborted due to timeout'), {
      name: 'TimeoutError',
    });
  }) as unknown as typeof fetch;

describe('probeTimesfm3', () => {
  it('counts any HTTP status as reachable', async () => {
    // The probe asks "did the process answer", not "is the route correct" — a 404 from a live
    // service is a live service.
    const probe = await probeTimesfm3(
      'https://timesfm.invalid',
      (async () => new Response('', { status: 404 })) as unknown as typeof fetch,
    );
    expect(probe.reachable).toBe(true);
    expect(probe.status).toBe(404);
  });

  it('reports a transport failure as unreachable, with its reason', async () => {
    const probe = await probeTimesfm3(
      'https://timesfm.invalid',
      (async () => {
        throw new Error('connect ECONNREFUSED');
      }) as unknown as typeof fetch,
    );
    expect(probe.reachable).toBe(false);
    expect(probe.error).toContain('ECONNREFUSED');
  });

  it('hands the fetch implementation an abort signal, so the wait is bounded', async () => {
    // This is the bug the deployment battery found. The probe fetched with no signal at all, so it
    // waited as long as the socket did; TimesFM-3 scales to zero, so a cold start outlasted the
    // function's budget and the route returned a 504 that reads as "the indexer is down".
    const captured: { signal: AbortSignal | null | undefined } = { signal: undefined };
    const probe = await probeTimesfm3('https://timesfm.invalid', reporting(captured), 10);

    expect(captured.signal).toBeInstanceOf(AbortSignal);
    expect(probe.reachable).toBe(false);
  });

  it('says a cold start is why, so the reader knows it may recover', async () => {
    const probe = await probeTimesfm3('https://timesfm.invalid', reporting({ signal: undefined }), 10);
    expect(probe.error).toContain('no response within 10ms');
    expect(probe.error).toContain('scales to zero');
  });

  it('does not dress a transport failure up as a timeout', async () => {
    // The two need different responses from a reader: one is a dependency waking up, the other is a
    // dependency that is misconfigured or down.
    const probe = await probeTimesfm3(
      'https://timesfm.invalid',
      (async () => {
        throw new Error('getaddrinfo ENOTFOUND');
      }) as unknown as typeof fetch,
      10,
    );
    expect(probe.error).toBe('getaddrinfo ENOTFOUND');
  });
});

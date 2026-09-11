/**
 * Shared test doubles.
 *
 * The fakes implement the package's ports, so tests exercise the real code paths
 * without touching a network, a cloud bucket, or the filesystem.
 */

import type { RiskStore } from '../src/store.js';

/**
 * An in-memory {@link RiskStore}.
 *
 * Records every call so a test can assert on what was asked for, and can be
 * primed to fail a specific operation — which is how the error-wrapping paths get
 * exercised without needing a real store to misbehave.
 */
export class FakeStore implements RiskStore {
  /** Objects currently held, keyed by key. */
  readonly objects = new Map<string, string>();

  /** Operations that should throw when next invoked. */
  readonly failures = new Set<'get' | 'put' | 'list' | 'exists'>();

  /** Every `get`/`put` key, in call order. */
  readonly calls: Array<{ op: string; key: string }> = [];

  /**
   * @param seed - Initial objects to hold.
   */
  constructor(seed: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(seed)) {
      this.objects.set(key, value);
    }
  }

  /** {@inheritDoc RiskStore.get} */
  async get(key: string): Promise<string | null> {
    this.calls.push({ op: 'get', key });
    if (this.failures.has('get')) throw new Error('simulated get failure');
    return this.objects.get(key) ?? null;
  }

  /** {@inheritDoc RiskStore.put} */
  async put(key: string, body: string): Promise<void> {
    this.calls.push({ op: 'put', key });
    if (this.failures.has('put')) throw new Error('simulated put failure');
    this.objects.set(key, body);
  }

  /** {@inheritDoc RiskStore.list} */
  async list(prefix: string): Promise<string[]> {
    this.calls.push({ op: 'list', key: prefix });
    if (this.failures.has('list')) throw new Error('simulated list failure');
    return [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort();
  }

  /** {@inheritDoc RiskStore.exists} */
  async exists(key: string): Promise<boolean> {
    this.calls.push({ op: 'exists', key });
    if (this.failures.has('exists')) throw new Error('simulated exists failure');
    return this.objects.has(key);
  }
}

/**
 * Tests for the runner's failure reporting.
 *
 * The behaviour under test is narrow but was a real obstacle: a driver failure
 * with an *empty* message produced the error string
 * `"TimescaleDB query failed: "` — a message that names nothing, which is exactly
 * how a wrong host or a refused connection presents itself. Diagnosing it means
 * knowing the message was empty and why, so these tests pin both.
 *
 * The `AggregateError` case is not hypothetical: Node reports a failed
 * multi-address connection that way, and its `message` is the empty string.
 *
 * These connect to a closed port on the loopback interface, so they never touch
 * the network and fail immediately rather than timing out.
 */

import { describe, expect, it } from 'vitest';
import { loadTimeseriesEnv, PgSqlRunner, resolveConnectionSpec } from '../src/runner.js';

/** A runner pointed at a port nothing can be listening on. */
function runnerAtClosedPort(): PgSqlRunner {
  return new PgSqlRunner(
    resolveConnectionSpec(
      loadTimeseriesEnv({ TIMESERIES_DATABASE_URL: 'postgres://u:p@127.0.0.1:1/tsdb' }),
    ),
  );
}

describe('driver error reporting', () => {
  it('names the refusal rather than returning an empty message', async () => {
    // The regression: an unreachable host produced "TimescaleDB query failed: "
    // with nothing after the colon, so an operator had no lead at all.
    const runner = runnerAtClosedPort();

    let message = '';
    try {
      await runner.query('SELECT 1');
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    } finally {
      await runner.close().catch(() => undefined);
    }

    expect(message.length).toBeGreaterThan('TimescaleDB query failed: '.length);
    // Actionable: it names the failure class or the driver code.
    expect(message).toMatch(/ECONNREFUSED|connect|refused|connection/i);
  }, 20_000);

  it('distinguishes a connection failure from a transaction failure', async () => {
    // Acquiring a client is separated from the work inside the transaction, so
    // the two failures do not read alike and an operator is not sent looking at
    // a query that never ran.
    const runner = runnerAtClosedPort();

    let message = '';
    try {
      await runner.transaction(async () => 'never reached');
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    } finally {
      await runner.close().catch(() => undefined);
    }

    expect(message).toContain('connection failed');
    expect(message.length).toBeGreaterThan('TimescaleDB connection failed: '.length);
  }, 20_000);
});

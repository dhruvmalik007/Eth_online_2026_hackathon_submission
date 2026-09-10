import { describe, expect, it } from 'vitest';
import {
  isLocalHost,
  loadTimeseriesEnv,
  resolveConnectionSpec,
  resolveSsl,
  stripSslParams,
  toPoolConfig,
} from '../src/runner.js';

const env = (over: Record<string, unknown> = {}) =>
  loadTimeseriesEnv({ ...over });

describe('isLocalHost', () => {
  it('treats loopback and .local as local', () => {
    expect(isLocalHost('localhost')).toBe(true);
    expect(isLocalHost('127.0.0.1')).toBe(true);
    expect(isLocalHost('::1')).toBe(true);
    expect(isLocalHost('db.local')).toBe(true);
  });

  it('treats managed endpoints as remote', () => {
    expect(isLocalHost('fz69vetmvi.rpnxztmavh.tsdb.cloud.timescale.com')).toBe(false);
  });
});

describe('resolveSsl', () => {
  it('honours an explicit disable', () => {
    expect(resolveSsl('remote.example.com', 'disable')).toEqual({ setting: false, auto: false });
  });

  it('encrypts without verifying for libpq require semantics', () => {
    // Tiger Cloud terminates TLS with its own CA, so Node's trust store
    // rejects the chain; `require` must not mean "verify".
    expect(resolveSsl('remote.example.com', 'require')).toEqual({
      setting: { rejectUnauthorized: false },
      auto: false,
    });
  });

  it('verifies when a CA bundle is supplied', () => {
    expect(resolveSsl('remote.example.com', 'require', 'PEM')).toEqual({
      setting: { rejectUnauthorized: true, ca: 'PEM' },
      auto: false,
    });
  });

  it('requires verification for verify-full', () => {
    expect(resolveSsl('remote.example.com', 'verify-full')).toEqual({
      setting: { rejectUnauthorized: true },
      auto: false,
    });
  });

  it('auto-enables TLS only for remote hosts with no explicit mode', () => {
    expect(resolveSsl('localhost', null)).toEqual({ setting: false, auto: false });
    expect(resolveSsl('remote.example.com', null)).toEqual({
      setting: { rejectUnauthorized: false },
      auto: true,
    });
  });
});

describe('stripSslParams', () => {
  it('removes sslmode so the resolved policy is authoritative', () => {
    // pg merges the parsed DSN *over* the explicit config, so a leftover
    // sslmode would silently override the SSL policy we resolved.
    const stripped = stripSslParams(
      'postgres://u:p@host:33924/tsdb?sslmode=require&application_name=x',
    );
    expect(stripped).not.toContain('sslmode');
    expect(stripped).toContain('application_name=x');
  });

  it('returns the original string when there is nothing to strip', () => {
    const url = 'postgres://u:p@host:5432/tsdb';
    expect(stripSslParams(url)).toBe(url);
  });

  it('is tolerant of an unparseable string', () => {
    expect(stripSslParams('not a url')).toBe('not a url');
  });
});

describe('resolveConnectionSpec', () => {
  it('prefers the DSN and strips its sslmode', () => {
    const spec = resolveConnectionSpec(
      env({
        TIMESERIES_DATABASE_URL:
          'postgres://tsdbadmin:secret@fz69vetmvi.rpnxztmavh.tsdb.cloud.timescale.com:33924/tsdb?sslmode=require',
      }),
    );
    expect(spec.fromConnectionString).toBe(true);
    expect(spec.connectionString).not.toContain('sslmode');
    expect(spec.ssl).toEqual({ rejectUnauthorized: false });
    expect(spec.sslAutoEnabled).toBe(false);
    expect(spec.maxConnections).toBe(5);
  });

  it('builds a DSN from discrete keys and leaves localhost unencrypted', () => {
    const spec = resolveConnectionSpec(
      env({
        TIMESERIES_DB_HOST: 'localhost',
        TIMESERIES_DB_PORT: 5432,
        TIMESERIES_DB_NAME: 'agentic_ems',
        TIMESERIES_DB_USER: 'postgres',
      }),
    );
    expect(spec.fromConnectionString).toBe(false);
    expect(spec.connectionString).toBe('postgres://postgres@localhost:5432/agentic_ems');
    expect(spec.ssl).toBe(false);
  });

  it('auto-enables TLS for a remote host given as discrete keys', () => {
    const spec = resolveConnectionSpec(env({ TIMESERIES_DB_HOST: 'db.example.com' }));
    expect(spec.sslAutoEnabled).toBe(true);
    expect(spec.ssl).toEqual({ rejectUnauthorized: false });
  });

  it('rejects a DSN with no host', () => {
    expect(() =>
      resolveConnectionSpec(env({ TIMESERIES_DATABASE_URL: 'not-a-dsn' })),
    ).toThrowError(/not a valid Postgres DSN/);
  });

  it('caps the free-tier pool size by default', () => {
    const spec = resolveConnectionSpec(
      env({ TIMESERIES_DATABASE_URL: 'postgres://u:p@host:5432/tsdb' }),
    );
    expect(toPoolConfig(spec).max).toBe(5);
  });
});

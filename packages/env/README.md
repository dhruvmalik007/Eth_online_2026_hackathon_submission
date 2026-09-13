# @ethonline2026/env

One catalog for every environment variable the workspace reads, plus a CLI that validates an
environment, generates `.env.example` files, and emits the manifest CI uses to check a deployment.

## Why

Before this package, six services hand-wrote zod schemas, three apps read `process.env` with no schema
at all, and twelve `.env.example` files drifted from the code. A variable that is described in two
places is a variable that is wrong in one of them.

## Commands

```bash
pnpm env:check                 # validate the local environment (EMS_ENV=local)
pnpm env:check:staging         # validate staging from .env.staging, flagging unknown keys
pnpm env:example               # print a .env.example generated from the catalog
pnpm env:manifest              # the machine-readable contract CI reads
```

`ems-env check --service execution --env production` validates a single service; exit code `1` means
at least one required variable is missing or malformed, `2` means the command was misused.

## Environments

Three, deliberately: `local`, `staging`, `production`. There is no `test` or `preview` lane — CI runs
with `EMS_ENV=local` against a containerised database, and a pull request is exercised on `staging`.
`EMS_ENV` must be explicit outside local; it defaults to `local` only there.

## Adding a variable

Add it to `ENV_CATALOG` in `src/catalog.ts` with its services, the environments that require it, and
whether it is a secret. Never read it as a bare `process.env` lookup — read it through this package so
the catalog stays the single description. `.env.example` is generated, so never hand-edit it.

## Guarantees

- Secrets are marked in the catalog and are **redacted in every report**; a validation error names the
  variable, never the value.
- A required variable is required to be *explicit*: a default does not satisfy it, because a production
  deployment that silently fell back to a development default is the failure this package exists to
  prevent.

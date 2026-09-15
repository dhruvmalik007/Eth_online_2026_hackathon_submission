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

## Architecture

```
catalog.ts   the specification — one entry per variable: services, required-in, secret, format
   │
   ├─ schema.ts   zod schemas derived from the catalog  →  createEnv() / createClientEnv()
   ├─ load.ts     the same rules, reported as a list of issues → the CLI's `check`
   ├─ example.ts  .env.example           (generated, asserted in sync by a test)
   ├─ manifest.ts env.manifest.json      (the CI contract)
   └─ sync.ts     per-platform push scripts (Vercel · GCP Secret Manager · GitHub · dotenv)
```

The design follows **`@t3-oss/env-core`** where it is right — a `createEnv` that returns a validated,
typed object, and a hard client/server boundary — but the field list comes from the **catalog**, not
from a schema hand-written in each app. That is the one difference that matters here: t3-env has no
catalog, so names, secret flags and per-environment requirements would live only in application
source, and the docs, the CI manifest and the platform sync would have nothing to read from. Here
zod is the engine and the catalog is the specification, so a variable is described once and every
consumer is generated from that description.

Two t3-env rules are adopted unchanged:

1. **A client variable is identified by its framework prefix** (`NEXT_PUBLIC_`), never by a list
   someone maintains by hand.
2. **A secret may not carry a client prefix.** `createClientEnv` throws if the catalog ever marks a
   client variable secret — the failure it prevents is a credential in a browser bundle, which code
   review does not reliably catch.

### Injection

`createEnv({ service })` is the call a service makes at boot: "give me what I need, validated" —
defaults applied, secrets typed as available, every problem reported at once. Because the catalog
knows which names a service needs *per environment*, the same call drives filling them in:

```bash
pnpm env check --env staging --service execution      # what is missing or malformed
pnpm env sync  --target vercel --env staging --file .env.staging --dry-run   # names only
pnpm env sync  --target gcloud --env production --project agentic-ems --file .env.production
```

`sync` emits a script that **reads the values file and pipes each value straight into the platform
CLI**. It never prints a value — a sync tool that echoes secrets writes them into shell history, CI
logs and scrollback, and that convenience is not worth the cost. `gcloud` updates a version when the
secret exists (Secret Manager secrets are immutable) and creates it when it does not.

Each platform names its lanes its own way, so `sync` translates ours into theirs rather than sending
our vocabulary verbatim:

| ours | Vercel |
|---|---|
| `local` | `development` |
| `staging` | `preview` |
| `production` | `production` |

That translation is load-bearing, not cosmetic. Vercel has no `staging` lane, and `vercel env add`
rejects one with *"custom environment ids that do not exist: staging"* — which, under the `set -e` in
the generated script, kills the loop on the first variable and injects **nothing**, while the run still
looks like it succeeded. The generated command also passes `--non-interactive` and an explicit empty
git branch, because otherwise the CLI answers `action_required: git_branch_required` and exits rather
than adding a value unattended.

The values file is read from the working directory (`--file`, default `.env.<environment>`) and holds
real credentials. Keep it out of git — the root `.gitignore` covers `.env` but **not** `.env.staging`
or `.env.production`.

### Adding a variable

1. Add it to `ENV_CATALOG`.
2. Regenerate: `pnpm env example > .env.example` (a test fails if it is out of date).
3. Read it through `createEnv`, never as a bare `process.env` lookup — `test/drift.test.ts` fails the
   build if you do.

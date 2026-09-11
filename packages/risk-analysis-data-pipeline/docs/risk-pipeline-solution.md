# Risk pipeline — solution brief and standards conformance

This document records the architecture, the trade-offs taken, and the evidence for
each standard the package claims to meet. It exists so a reviewer can check the
claims rather than take them on trust: every section below names the file or the
command that demonstrates it.

---

## 1. What the package does

Two layers, deliberately split because they have opposite runtimes:

| Layer | Language | Runs where | Why |
|---|---|---|---|
| **Collection** | Python (`scraper/`) | Cloud Run **Job**, every 6h | Camoufox is a Firefox-based browser: it needs a process tree and ~1.3 GB, so it cannot run in a Vercel Function (250 MB, no process tree) |
| **Read + derive** | TypeScript (`src/`) | Vercel Functions, and as a library | Pure functions and validated reads, which is what a serverless request path can do |

The boundary between them is a set of JSON snapshots, validated on **both** sides:
pydantic enforces the shape on write, zod enforces it on read, and a drift test
(`test/contractDrift.test.ts`) feeds real Python output through the TypeScript
schemas so the two cannot diverge silently.

### The three source families

| Source | Transport | What it yields |
|---|---|---|
| L2Beat | server-rendered HTML, per-chain page | five decentralisation dimensions + Stage + value secured |
| Governance forums | Discourse JSON API (no auth, no browser) | proposals, stages, activity/participation scores |
| DefiLlama market makers | server-rendered HTML + one detail drawer per maker | 30-day depth/volume/spread/uptime, venue coverage |

**Why a browser at all, when two of three are plain HTTP.** The L2Beat chain pages
and the market-maker leaderboard are JavaScript-rendered in a way that a plain
fetch does not reliably reproduce, and the venue-coverage data exists *only*
behind a click. One transport that handles all three is simpler than two, and the
browser is the thing that cannot move to the request path regardless.

---

## 2. Trade-offs taken

| Decision | Alternative rejected | Why |
|---|---|---|
| Curated roster in `roster.json` | Discover protocols dynamically | An unverifiable list would silently change what the risk model conditions on; a curated list makes coverage an explicit, reviewable choice |
| Forward-fill covariate alignment | Linear interpolation | Risk series are step functions — interpolating between "no exit window" and "7 days" emits values nobody observed |
| GCS snapshots + TimescaleDB history | One store | Different access shapes: a snapshot answers "what is it now", a hypertable answers "what was it at each step of the target series" |
| `RangeError` for unit violations | A `RiskPipelineError` subclass | Containable errors get recorded and swallowed; a unit violation is a caller bug and must not be |
| Cloud Run **Job** | A Cloud Run Service | The work is a bounded batch with a natural exit; a Service bills while idle |

---

## 3. SOLID conformance (plan §10.1)

Each principle is stated as the check that would fail if it were violated.

### Single responsibility — *no module both parses HTML and writes SQL*

Evidence: `browser.py` only fetches; `sources/*.py` only parse; `publish.py` only
writes; `__main__.py` only orchestrates. The TypeScript split is the same:
`store.ts` (adapters), `repository.ts` (validated reads), `derive.ts` (pure math),
`reader.ts` (composition root). No file names two of those jobs.

### Open/closed — *a new source is a new file plus a registry row*

Evidence: `DiscourseSource.__init__` reads its targets from the roster
(`load_roster().protocols if p.transport == "discourse-json"`), so adding a
protocol is a data change. `base.py` is never edited to add a source — the
verification is that `git diff` on `base.py` for a new source is empty. A new
*source family* adds one class and one branch in `_build_sources`; that branch is
the composition root's job, not the base class's.

### Liskov substitution — *no subclass weakens the base contract*

Evidence: `Source.collect` is **concrete** in `base.py:143` and is not overridden
anywhere. Subclasses implement only `pages`/`parse` (or `collect_records` for
`ModalSource`), so the error containment and validation in `collect` cannot be
bypassed. `grep -rn "def collect" sources/` returns only `base.py` hits.

### Interface segregation — *ports are as narrow as the consumer needs*

Evidence: `PageFetcher` exposes one method (`fetch`); `DetailReader` extends it
with one more (`read_detail_modal`). `MarketMakerDetailSource` needs the wider
port because it must read the leaderboard *and* the drawers; the other three
sources take the narrower one. On the read side, `RiskProfileReader` is composed
of four ≤4-method ports (`ChainRiskReader`, `ProtocolGovernanceReader`,
`MarketMakerReader`, `RunManifestReader`) so a route serving chains does not
depend on market-maker methods.

### Dependency inversion — *every I/O dependency is an injected port*

Evidence: `run_sweep` takes a `PageFetcher` parameter (it used to construct
`CamoufoxFetcher` itself, which made the failure paths untestable without a
browser — fixed, and the reason `test_failure_paths.py` can run offline).
Composition roots own the concrete adapters: `main()` builds `CamoufoxFetcher` and
the writer; `reader.ts` builds the store; `runtime.ts` builds the serverless
graph. Library modules import only ports.

---

## 4. Zero-`any` audit (plan §10.2, T8.2)

The standard permits `any`/`Any` at exactly one place: the parse boundary for
untrusted external JSON, with an inline justification.

### TypeScript — zero occurrences

```
$ grep -rnE ":\s*any\b|<any>|any\[\]|as any" packages/risk-analysis-data-pipeline/src packages/risk-analysis-data-pipeline/test packages/risk-analysis-data-pipeline/scripts packages/langchain/src/graph/v01 packages/langchain/src/tools/risk
(no matches)
```

Every textual match for "any" in the source is prose inside a comment. Types are
derived (`z.infer`) rather than hand-written, and the two places that must widen
use `unknown` with a narrowing check instead.

### Python — one module, documented

```
$ grep -rnE "\bAny\b" scraper/risk_pipeline/
sources/discourse.py:30:from typing import Any
```

`Any` appears in `discourse.py` only, for the raw untrusted Discourse topic
object, and the import carries the justification inline (`discourse.py:23-29`):
upstream topic objects have no trustworthy static shape, every access is a runtime
check that raises `ParseError`, and pydantic validates into a `Proposal` before
any other module sees the payload. Everything above that boundary is fully typed.

---

## 5. Typed errors (plan §10.5, T8.6)

Every failure path in library code throws a member of the `RiskPipelineError`
family, with the identifier needed to act on it attached:

| Error | Carries | Containable? |
|---|---|---|
| `SourceError` | `sourceId` | yes — recorded as `failed`, sweep continues |
| `ParseError` | `sourceId`, `selector` | yes |
| `ValidationError` | `fieldPath`, value | yes |
| `StoreError` | `operation`, `key` | yes |
| `TemporalWriteError` | `table` | yes per-table — losing one series does not cost the others |
| `SnapshotContractError` | `key` | yes |
| `CovariateAlignmentError` | covariate name, expected/actual length | no — a shape bug, caught before the request |
| `RiskPipelineError` | — | base of the family |

```
$ grep -rn "throw new Error" packages/risk-analysis-data-pipeline/src/
(no matches)
$ grep -rnE "raise (Exception|ValueError|RuntimeError)\(" scraper/risk_pipeline/
(no matches)
```

**One documented exception:** the unit guards in `units.ts` throw the built-in
`RangeError`. This is deliberate and the reason is in the module header — a
`RiskPipelineError` is *containable* by design (the sweep records and continues),
whereas an out-of-range unit means the package was called incorrectly and must
crash rather than be degraded into a recorded partial outcome.

---

## 6. Documentation conventions (plan §10.4)

- Every module opens with a rationale header saying *why it exists*, not what it
  contains.
- Every exported class and function carries a docstring/JSDoc with `@param`,
  `@returns` and `@throws` where a failure is possible, plus `@example` where the
  call is non-obvious.
- Both languages enforce this rather than leaving it to discipline:
  `eslint-plugin-jsdoc` (`require-jsdoc` for exported symbols, `check-param-names`,
  `require-returns`) and `ruff`'s `D` rules.

**Deliberate configuration note:** `jsdoc/require-param` and
`jsdoc/check-param-names` run with `checkDestructured: false`. The object
parameter itself is still required and its name still validated, but its
*properties* are documented once on the named interface they come from rather than
restated in every signature — restating them drifts from the type. The interfaces
created for this (`RiskRecordsInput`, `WriteRiskHistoryInput`, `IncidentInput`)
are the evidence.

---

## 7. Verification

| Gate | Command | Result |
|---|---|---|
| TypeScript types | `pnpm --filter @ethonline2026/risk-analysis-data-pipeline typecheck` | clean |
| TypeScript lint | `… lint` | clean |
| TypeScript tests | `… test` | 125 passed |
| TypeScript type-level | `… exec vitest run test/types.test.ts` | 12 passed |
| Python types | `uv run mypy` (strict) | clean, 27 files |
| Python lint + format | `uv run ruff check . && uv run ruff format --check .` | clean |
| Python tests | `uv run pytest tests/` | 129 passed |
| Live pipeline | `pnpm verify:local` | 30/30 checks against real Tiger Cloud |
| Live integrated (opt-in) | `RISK_E2E=1 … test:e2e` | real Camoufox sweep + TimescaleDB + vector search |

The consumer-side wiring is verified in `packages/langchain` (170 tests) and
`apps/indexer` (53 tests), including the risk routes and the `MertonPDTool`
default-preserving path.

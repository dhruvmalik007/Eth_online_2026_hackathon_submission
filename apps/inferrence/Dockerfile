# syntax=docker/dockerfile:1
#
# apps/inferrence — Cloud Run control-plane image.
#
# The build context is the repo ROOT (the pnpm workspace needs every member's
# manifest to resolve `workspace:*` links). Build with:
#
#   docker build -f apps/inferrence/Dockerfile -t inferrence:local .
#
# No GPU: models are Vertex AI (managed) and the self-hosted TimesFM-3 Cloud Run
# service. This container hosts sandboxes, not model weights.
#
# ---------------------------------------------------------------------------
# Layer order is deliberate, and it is the difference between a ~9-minute rebuild
# and a ~1-minute one. Stages are ordered least- to most-frequently changed:
#
#   1. manifests  → `pnpm install`          (changes only when a dependency does)
#   2. packages/  → build workspace deps    (changes when a package does)
#   3. apps/inferrence → build the app      (changes on every commit)
#
# The previous layout copied `packages/` *before* installing, so every source edit
# invalidated the install and reinstalled the whole workspace. `--cache-from` in
# cloudbuild.yaml lets these stages survive across builds on a fresh builder.
# ---------------------------------------------------------------------------

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo

# ── Stage 1: dependency install ──────────────────────────────────────────────
# Only manifests. Listed explicitly rather than `COPY packages ./packages`
# because that would invalidate this layer on every source change. pnpm needs
# every workspace member's manifest to resolve `workspace:*`, so if a package is
# added and its line is missing, the install fails loudly rather than producing a
# silently incomplete image.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY packages/arc/package.json ./packages/arc/
COPY packages/bridges/package.json ./packages/bridges/
COPY packages/custody/package.json ./packages/custody/
COPY packages/execution-domain/package.json ./packages/execution-domain/
COPY packages/langchain/package.json ./packages/langchain/
COPY packages/risk-analysis-data-pipeline/package.json ./packages/risk-analysis-data-pipeline/
COPY packages/the-graph/package.json ./packages/the-graph/
COPY packages/timeseries/package.json ./packages/timeseries/
COPY packages/ux-workflow/package.json ./packages/ux-workflow/
COPY apps/indexer/package.json ./apps/indexer/
COPY apps/execution/package.json ./apps/execution/
COPY apps/inferrence/package.json ./apps/inferrence/
# A FULL workspace install, not `--filter …`: the filtered form resolves only the
# selected project's dependencies and would leave the root `turbo` binary out.
# No workspace member has a prepare/postinstall script, so this is side-effect free.
RUN pnpm install --frozen-lockfile

# ── Stage 2: workspace dependencies ──────────────────────────────────────────
# The `^...` filter builds only inferrence's dependencies, never inferrence itself,
# so this layer is reused for app-only changes.
FROM deps AS packages-built
COPY packages ./packages
RUN pnpm turbo run build --filter=@ethonline2026/inferrence^...

# ── Stage 3: the app ────────────────────────────────────────────────────────
FROM packages-built AS build
COPY apps/inferrence ./apps/inferrence
RUN pnpm --filter @ethonline2026/inferrence build

# Note: the runtime copies the whole /repo (~1.5 GB). Two attempts at slimming it
# are worth recording so they are not retried blindly:
#   - `pnpm deploy --prod --legacy` re-resolves the dependency graph instead of
#     reusing the installed tree; it needs `git` and network, and fails on a
#     transitive git dependency of @graphprotocol/client-cli.
#   - plain `--prod` is refused without `inject-workspace-packages=true`, which is
#     a repo-wide install-semantics change (workspace links become copied dirs)
#     and deserves its own pass rather than being smuggled in here.
# The size is dominated by heavyweight production dependencies (the Graph
# Protocol client CLI, langchain/langgraph, protocol-kit, the Ledger kits), so a
# real fix is a lockfile-aware prune, not deleting source files.

FROM node:22-slim AS runtime
ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
WORKDIR /repo
RUN groupadd --system --gid 1001 inferrence \
  && useradd --system --uid 1001 --gid inferrence inferrence
COPY --from=build --chown=inferrence:inferrence /repo /repo
USER inferrence
EXPOSE 8080
# Sandboxes need a writable rootfs; Cloud Run provides a tmpfs-backed /tmp.
ENV SANDBOX_ROOT=/tmp/inferrence-sandboxes
CMD ["node", "apps/inferrence/dist/src/main.js"]

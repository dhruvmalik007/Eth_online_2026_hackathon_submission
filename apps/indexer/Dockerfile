# The indexer, as a container.
#
# Why this exists: the Vercel deployment cannot reach TimescaleDB. The database takes a fixed IP
# allowlist, Vercel's egress addresses are not on it, and the sponsored-static-IP tier costs more
# than this demo is worth. A container running where the database already trusts the network removes
# the problem rather than working around it — no tunnel, no proxy, no allowlist edit.
#
#   docker build -f apps/indexer/Dockerfile -t agentic-ems-indexer .
#   docker run --rm -p 3001:3001 --env-file apps/indexer/.env.local agentic-ems-indexer
#
# Then point the app at it: NEXT_PUBLIC_INDEXER_URL=http://localhost:3001

FROM node:24-alpine

WORKDIR /app

# Corepack pins the pnpm version this repo locks against; installing pnpm blindly would drift.
RUN corepack enable

# Manifests first, so the install layer caches across source edits.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/indexer/package.json apps/indexer/
COPY packages/ ./packages/
COPY apps/ ./apps/

RUN pnpm install --frozen-lockfile --filter @ethonline2026/indexer...

WORKDIR /app/apps/indexer

ENV NODE_ENV=production
EXPOSE 3001

# The same entry point `pnpm dev:local` uses. The handlers are unchanged — they already speak
# `Request`/`Response`, so hosting them on Node's own http server is an adapter, not a rewrite.
CMD ["pnpm", "exec", "tsx", "scripts/serve-local.ts"]

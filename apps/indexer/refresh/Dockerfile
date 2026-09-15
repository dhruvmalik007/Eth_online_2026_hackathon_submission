# The cache refresh job.
#
# Deliberately standalone rather than a workspace package: the root workspace lists `apps/indexer`,
# not `apps/**`, so this directory is outside it — and it must be, because the image installs its own
# two dependencies and carries no reference to the monorepo. That keeps the image small and means a
# change to the indexer's package.json cannot silently change what the job runs.
FROM node:22-alpine

WORKDIR /app

# Dependencies first, so a change to index.js does not invalidate the install layer.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY index.js ./

# The job needs no root at runtime: it writes to GCS over HTTPS and to nowhere on disk.
USER node

CMD ["node", "index.js"]

#!/usr/bin/env bash
# verify-image.sh — build the image and prove no credentials are inside it.
#
# The repo has real secrets committed in `packages/*/.env` files, and the
# Dockerfile copies `packages/` wholesale because the pnpm workspace needs every
# manifest. `.dockerignore` is the guard; this is the check that it works.
#
#   apps/inferrence/scripts/verify-image.sh
#
# Exits non-zero if the image builds without the expected layout, or if any
# `.env`-like file is present.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
IMAGE="${IMAGE:-inferrence:verify}"

cd "$REPO_ROOT"
echo "── building ${IMAGE} (context: repo root) ──"
docker build -f apps/inferrence/Dockerfile -t "$IMAGE" .

echo
echo "── asserting no .env files in the image ──"
found="$(docker run --rm --entrypoint sh "$IMAGE" -c \
  "find / -name '.env*' -not -path '*/node_modules/*' 2>/dev/null" || true)"

if [ -n "$found" ]; then
  echo "FAIL: the image contains credential files:" >&2
  echo "$found" >&2
  exit 1
fi
echo "OK: no .env files in the image."

echo
echo "── asserting the app entrypoint is present ──"
docker run --rm --entrypoint sh "$IMAGE" -c \
  "test -f /repo/apps/inferrence/dist/src/main.js && echo 'OK: apps/inferrence/dist/src/main.js present'"

echo
echo "── booting the image on the default port ──"
cid="$(docker run -d -p 18080:8080 "$IMAGE")"
trap 'docker rm -f "$cid" >/dev/null 2>&1 || true' EXIT

for _ in $(seq 1 30); do
  if curl -sf http://127.0.0.1:18080/health > /dev/null; then
    echo "OK: /health responded"
    curl -s http://127.0.0.1:18080/health | head -c 400
    echo
    exit 0
  fi
  sleep 1
done

echo "FAIL: the container did not become healthy" >&2
docker logs "$cid" >&2 || true
exit 1

#!/usr/bin/env bash
# MCP loader for The Graph Subgraph MCP server.
# Resolves the gateway key from the-graph/.env at every server start, so no
# secret lives in .mcp.json and no session restart is needed after key rotation.
# Env precedence: an existing GATEWAY_API_KEY in the environment wins over .env.
set -euo pipefail
ENV_FILE="$(cd "$(dirname "$0")" && pwd)/.env"
if [ -z "${GATEWAY_API_KEY:-}" ] && [ -f "$ENV_FILE" ]; then
  VALUE="$(grep -E '^GATEWAY_API_KEY=.' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\"'"'"'')"
  [ -n "$VALUE" ] && export GATEWAY_API_KEY="$VALUE"
fi
if [ -z "${GATEWAY_API_KEY:-}" ]; then
  echo "subgraph MCP loader: GATEWAY_API_KEY not set (the-graph/.env)" >&2
  exit 1
fi
export AUTH_HEADER="Bearer ${GATEWAY_API_KEY}"
exec npx -y mcp-remote --header 'Authorization:${AUTH_HEADER}' https://subgraphs.mcp.thegraph.com/sse

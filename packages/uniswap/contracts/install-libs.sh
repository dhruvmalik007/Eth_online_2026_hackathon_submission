#!/usr/bin/env bash
# Vendors the only dependency this project has.
#
# Tarballs rather than `forge install`, for the same reason as the 1inch project: submodules write to
# the repository's own git state, and the pinned revision belongs in a file a reader can inspect.
set -euo pipefail
cd "$(dirname "$0")"

fetch() {
  local name="$1" url="$2" tmp
  tmp="$(mktemp -d)"
  curl -sfL "$url" | tar xz -C "$tmp"
  rm -rf "lib/$name"
  mv "$tmp/$(ls "$tmp" | head -1)" "lib/$name"
  rm -rf "$tmp"
  echo "ok       $name"
}

mkdir -p lib
fetch forge-std https://github.com/foundry-rs/forge-std/archive/refs/tags/v1.11.0.tar.gz

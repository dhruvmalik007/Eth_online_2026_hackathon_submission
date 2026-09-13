#!/usr/bin/env bash
# Populate contracts/lib/ from the pins in lib.lock.
#
# Idempotent: re-running replaces each tree. Downloads tarballs rather than using
# `forge install`, because forge's installer uses git submodules — which would
# write to `.gitmodules` and the index of the repository this work sits inside.
# These are plain source trees with no git metadata, so the parent repo is
# untouched and `lib/` stays ignorable.
set -euo pipefail

cd "$(dirname "$0")"
mkdir -p lib

# name|url — kept in step with lib.lock.
DEPS=(
  "forge-std|https://github.com/foundry-rs/forge-std/archive/refs/tags/v1.11.0.tar.gz"
  "openzeppelin|https://github.com/OpenZeppelin/openzeppelin-contracts/archive/refs/tags/v5.4.0.tar.gz"
  "solidity-utils|https://github.com/1inch/solidity-utils/archive/refs/tags/6.9.10.tar.gz"
  "aqua|https://github.com/1inch/aqua/archive/refs/tags/v1.0.0.tar.gz"
  "swap-vm|https://github.com/1inch/swap-vm/archive/refs/heads/main.tar.gz"
)

for dep in "${DEPS[@]}"; do
  name="${dep%%|*}"
  url="${dep#*|}"

  tmp="$(mktemp -d)"
  if ! curl -sfL "$url" | tar xz -C "$tmp" 2>/dev/null; then
    echo "FAILED  $name  <- $url" >&2
    rm -rf "$tmp"
    exit 1
  fi

  # GitHub tarballs wrap everything in one top-level directory named after the
  # ref, so lift that directory up to lib/<name>.
  inner="$(ls "$tmp" | head -1)"
  if [ -z "$inner" ] || [ ! -d "$tmp/$inner" ]; then
    echo "FAILED  $name  <- $url (tarball had no top-level directory; a wrong ref yields an empty archive rather than an error)" >&2
    rm -rf "$tmp"
    exit 1
  fi

  rm -rf "lib/$name"
  mv "$tmp/$inner" "lib/$name"
  rm -rf "$tmp"

  count="$(find "lib/$name" -name '*.sol' | wc -l | tr -d ' ')"
  printf 'ok      %-20s %s sol files\n' "$name" "$count"

  # A zero-file tree means the ref was wrong. This is the check that turns the
  # silent-empty-directory failure above into a loud one.
  if [ "$count" -eq 0 ]; then
    echo "FAILED  $name vendored no Solidity — check the ref in lib.lock" >&2
    exit 1
  fi
done

echo
echo "Vendored. Next: forge build && forge test"

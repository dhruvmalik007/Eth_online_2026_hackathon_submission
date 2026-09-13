#!/usr/bin/env bash
# Merge the AutoCapture-downloaded Agentic EMS scene clips into one demo video
# for the hackathon channel page.
#
# The scene prompts are written to open on hard cuts, so a plain concat is the
# designed join — no crossfades needed. All clips share FastH3's fixed output
# params (1344x768, h264 + aac), so the concat demuxer can stream-copy when
# the sources agree; pass --reencode to force a normalize pass if a clip
# drifts (different sample rate, timebase, etc.).
#
# Usage:
#   ./scripts/merge-clips.sh ~/Downloads/agentic-ems-scene-*.mp4
#   ./scripts/merge-clips.sh --reencode clip1.mp4 clip2.mp4 ...
#
# Output: agentic-ems-demo.mp4 next to the first input.

set -euo pipefail

REENCODE=0
ARGS=()
for a in "$@"; do
  if [[ "$a" == "--reencode" ]]; then REENCODE=1; else ARGS+=("$a"); fi
done

if [[ ${#ARGS[@]} -lt 2 ]]; then
  echo "usage: merge-clips.sh [--reencode] clip1.mp4 clip2.mp4 [...] (in story order)"
  exit 1
fi

OUT="$(dirname "${ARGS[0]}")/agentic-ems-demo.mp4"
LIST="$(mktemp /tmp/agentic-concat-XXXXXX.txt)"

for f in "${ARGS[@]}"; do
  echo "file '$(realpath "$f")'" >> "$LIST"
done

echo "Merging ${#ARGS[@]} clips -> $OUT"
cat "$LIST"

if [[ $REENCODE -eq 1 ]]; then
  # Normalize pass: forces identical codec params, safest across mixed sources.
  ffmpeg -y -f concat -safe 0 -i "$LIST" \
    -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p \
    -c:a aac -b:a 192k -ar 48000 \
    -movflags +faststart "$OUT"
else
  # Stream-copy pass: zero re-encode, exact frames preserved.
  ffmpeg -y -f concat -safe 0 -i "$LIST" -c copy -movflags +faststart "$OUT"
fi

rm -f "$LIST"
echo "Done: $OUT"

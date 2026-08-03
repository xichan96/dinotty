#!/usr/bin/env bash
# Generate a star history SVG chart from GitHub stargazers data.
# Incremental: caches daily star counts locally, only fetches new pages on subsequent runs.
# Requires: gh (GitHub CLI) authenticated, python3
# Output: docs/public/images/star-history.svg

set -euo pipefail

REPO="xichan96/dinotty"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT_DIR/docs/public/images"
OUT_FILE="$OUT_DIR/star-history.svg"
CACHE_FILE="$ROOT_DIR/.star-cache"
PER_PAGE=100

mkdir -p "$OUT_DIR"

# Get current star count from repo metadata (1 API call)
CURRENT_COUNT=$(gh api "repos/$REPO" --jq '.stargazers_count' 2>/dev/null)
if [ -z "$CURRENT_COUNT" ] || [ "$CURRENT_COUNT" -eq 0 ]; then
  echo "Error: failed to get repo info" >&2
  exit 1
fi

# Count total entries in cache (sum of daily counts)
CACHED_COUNT=0
if [ -f "$CACHE_FILE" ]; then
  CACHED_COUNT=$(awk '{s+=$2} END{print s+0}' "$CACHE_FILE")
fi

# ── Determine fetch strategy ──

if [ ! -f "$CACHE_FILE" ] || [ "$CACHED_COUNT" -eq 0 ]; then
  # Cold start: full fetch
  echo "No cache, fetching all $CURRENT_COUNT stars..."
  RAW=$(gh api "repos/$REPO/stargazers?per_page=$PER_PAGE" \
    --header 'Accept: application/vnd.github.v3.star+json' \
    --paginate -q '.[].starred_at' 2>/dev/null | cut -dT -f1)
  echo "$RAW" | sort | uniq -c | awk '{printf "%s %d\n", $2, $1}' > "$CACHE_FILE"

elif [ "$CACHED_COUNT" -eq "$CURRENT_COUNT" ]; then
  echo "Cache hit: $CACHED_COUNT stars, no fetch needed"

elif [ "$CACHED_COUNT" -gt "$CURRENT_COUNT" ]; then
  # Stars removed, refetch
  echo "Cache stale ($CACHED_COUNT > $CURRENT_COUNT), full refetch..."
  RAW=$(gh api "repos/$REPO/stargazers?per_page=$PER_PAGE" \
    --header 'Accept: application/vnd.github.v3.star+json' \
    --paginate -q '.[].starred_at' 2>/dev/null | cut -dT -f1)
  echo "$RAW" | sort | uniq -c | awk '{printf "%s %d\n", $2, $1}' > "$CACHE_FILE"

else
  # Incremental: fetch only new entries
  DELTA=$((CURRENT_COUNT - CACHED_COUNT))
  START_PAGE=$(( (CACHED_COUNT / PER_PAGE) + 1 ))
  SKIP=$((CACHED_COUNT - (START_PAGE - 1) * PER_PAGE))

  echo "Fetching $DELTA new stars from page $START_PAGE (skip $SKIP)..."
  RAW=$(gh api "repos/$REPO/stargazers?per_page=$PER_PAGE&page=$START_PAGE" \
    --header 'Accept: application/vnd.github.v3.star+json' \
    -q '.[].starred_at' 2>/dev/null | cut -dT -f1)

  if [ -n "$RAW" ]; then
    # Trim: skip already-cached entries on first page, keep exactly DELTA new ones
    NEW_DATES=$(echo "$RAW" | tail -n +$((SKIP + 1)) | head -n "$DELTA")
    if [ -n "$NEW_DATES" ]; then
      # Aggregate new entries by date
      NEW_COUNTS=$(echo "$NEW_DATES" | sort | uniq -c | awk '{printf "%s %d\n", $2, $1}')
      # Merge: sum counts for matching dates
      MERGED=$(cat "$CACHE_FILE" <(echo "$NEW_COUNTS") | sort | awk '
        { key=$1; val=$2 }
        key==prev { sum+=val; next }
        prev!=""  { printf "%s %d\n", prev, sum }
        { prev=key; sum=val }
        END { if (prev!="") printf "%s %d\n", prev, sum }
      ')
      echo "$MERGED" > "$CACHE_FILE"
    fi
  fi
  echo "Cache updated: $(awk '{s+=$2} END{print s+0}' "$CACHE_FILE") stars"
fi

# Read final cache
TOTAL=$(awk '{s+=$2} END{print s+0}' "$CACHE_FILE")
if [ "$TOTAL" -eq 0 ]; then
  echo "Error: no star data available" >&2
  exit 1
fi

python3 - "$CACHE_FILE" "$TOTAL" "$OUT_FILE" << 'PYEOF'
import sys
from collections import OrderedDict
from datetime import datetime, timedelta

cache_file = sys.argv[1]
total = int(sys.argv[2])
out_file = sys.argv[3]

# Read daily counts from cache
daily = OrderedDict()
with open(cache_file) as f:
    for line in f:
        parts = line.strip().split()
        if len(parts) == 2:
            daily[parts[0]] = int(parts[1])

# Fill gaps and build cumulative
cumulative = OrderedDict()
cum = 0
start = datetime.strptime(min(daily.keys()), '%Y-%m-%d')
end = datetime.strptime(max(daily.keys()), '%Y-%m-%d')
current = start
while current <= end:
    ds = current.strftime('%Y-%m-%d')
    cum += daily.get(ds, 0)
    cumulative[ds] = cum
    current += timedelta(days=1)

dates = list(cumulative.keys())
values = list(cumulative.values())
n = len(dates)

# SVG dimensions
width = 800
height = 300
pad_left = 55
pad_right = 20
pad_top = 40
pad_bottom = 50
chart_w = width - pad_left - pad_right
chart_h = height - pad_top - pad_bottom

max_val = max(values)

def x_pos(i):
    return pad_left + (i / max(n - 1, 1)) * chart_w

def y_pos(v):
    return pad_top + chart_h - (v / max(max_val, 1)) * chart_h

# Build polyline points
points = ' '.join(f'{x_pos(i):.1f},{y_pos(v):.1f}' for i, v in enumerate(values))

# Gradient fill area
area_points = points + f' {x_pos(n-1):.1f},{y_pos(0):.1f} {x_pos(0):.1f},{y_pos(0):.1f}'

# Y-axis ticks (5 ticks)
y_ticks = []
for i in range(6):
    v = int(max_val * i / 5)
    y = y_pos(v)
    y_ticks.append((v, y))

# X-axis labels (pick ~6 dates)
x_label_indices = []
step = max(1, (n - 1) // 5)
for i in range(0, n, step):
    x_label_indices.append(i)
if x_label_indices[-1] != n - 1:
    x_label_indices.append(n - 1)

svg = f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}">
  <defs>
    <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#FFD700" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="#FFD700" stop-opacity="0.02"/>
    </linearGradient>
  </defs>
  <rect width="{width}" height="{height}" rx="8" fill="#0d1117"/>

  <!-- Title -->
  <text x="{width/2}" y="22" text-anchor="middle" fill="#e6edf3" font-family="system-ui,sans-serif" font-size="14" font-weight="600">
    Star History - {total} stars
  </text>

  <!-- Y-axis grid + labels -->
'''

for v, y in y_ticks:
    svg += f'  <line x1="{pad_left}" y1="{y:.1f}" x2="{width - pad_right}" y2="{y:.1f}" stroke="#21262d" stroke-width="0.5"/>\n'
    svg += f'  <text x="{pad_left - 8}" y="{y + 4:.1f}" text-anchor="end" fill="#8b949e" font-family="system-ui,sans-serif" font-size="10">{v}</text>\n'

svg += f'''
  <!-- Area fill -->
  <polygon points="{area_points}" fill="url(#fill)"/>

  <!-- Line -->
  <polyline points="{points}" fill="none" stroke="#FFD700" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>

  <!-- X-axis labels -->
'''

for i in x_label_indices:
    x = x_pos(i)
    short = dates[i][5:]  # MM-DD
    svg += f'  <text x="{x:.1f}" y="{height - pad_bottom + 18}" text-anchor="middle" fill="#8b949e" font-family="system-ui,sans-serif" font-size="10">{short}</text>\n'

last_x = x_pos(n - 1)
last_y = y_pos(values[-1])
svg += f'''
  <!-- End dot -->
  <circle cx="{last_x:.1f}" cy="{last_y:.1f}" r="4" fill="#FFD700"/>
  <text x="{last_x - 2}" y="{last_y - 10}" text-anchor="end" fill="#FFD700" font-family="system-ui,sans-serif" font-size="12" font-weight="600">{values[-1]}</text>
</svg>'''

with open(out_file, 'w') as f:
    f.write(svg)

print(f"Generated {out_file} ({total} stars, {n} days)")
PYEOF

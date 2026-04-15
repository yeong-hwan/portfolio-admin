#!/bin/bash
# Daily checkpoint logger - runs via cron at US market close (KST 05:10)
# No server needed. Calls tossctl directly.

set -euo pipefail

DATA_DIR="$(dirname "$0")/../data"
CHECKPOINTS_FILE="$DATA_DIR/checkpoints.json"
mkdir -p "$DATA_DIR"

# Determine market close date (US Eastern)
if date -v0H >/dev/null 2>&1; then
  # macOS date
  ET_OFFSET=$(python3 -c "
from datetime import datetime, timezone, timedelta
import time
now = datetime.now(timezone.utc)
# US DST: March 2nd Sunday - November 1st Sunday
year = now.year
march = datetime(year,3,8,tzinfo=timezone.utc)
march += timedelta(days=(6-march.weekday())%7)
nov = datetime(year,11,1,tzinfo=timezone.utc)
nov += timedelta(days=(6-nov.weekday())%7)
offset = -4 if march <= now < nov else -5
print(offset)
")
  ET_NOW=$(TZ="Etc/GMT+${ET_OFFSET#-}" date +"%Y-%m-%d %H")
  ET_DATE=$(echo "$ET_NOW" | cut -d' ' -f1)
  ET_HOUR=$(echo "$ET_NOW" | cut -d' ' -f2)
else
  ET_DATE=$(TZ="America/New_York" date +"%Y-%m-%d")
  ET_HOUR=$(TZ="America/New_York" date +"%H")
fi

MARKET_DATE="$ET_DATE"

# Check if already saved for this date
if [ -f "$CHECKPOINTS_FILE" ]; then
  if grep -q "\"marketDate\":\"$MARKET_DATE\"" "$CHECKPOINTS_FILE" 2>/dev/null; then
    echo "Checkpoint for $MARKET_DATE already exists. Skipping."
    exit 0
  fi
fi

# Fetch data
SUMMARY=$(tossctl account summary --output json 2>/dev/null) || { echo "Failed to fetch summary"; exit 1; }
POSITIONS=$(tossctl portfolio positions --output json 2>/dev/null) || { echo "Failed to fetch positions"; exit 1; }
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
ID=$(python3 -c "import time; print(int(time.time()*1000))")

# Build checkpoint JSON
CHECKPOINT=$(python3 -c "
import json, sys
summary = json.loads('''$SUMMARY''')
positions = json.loads('''$POSITIONS''')
checkpoint = {
    'id': $ID,
    'marketDate': '$MARKET_DATE',
    'timestamp': '$TIMESTAMP',
    'summary': summary,
    'positions': positions
}
print(json.dumps(checkpoint))
")

# Append to checkpoints file
if [ -f "$CHECKPOINTS_FILE" ]; then
  # Append to existing array
  python3 -c "
import json
with open('$CHECKPOINTS_FILE', 'r') as f:
    data = json.load(f)
data.append(json.loads('''$CHECKPOINT'''))
with open('$CHECKPOINTS_FILE', 'w') as f:
    json.dump(data, f, indent=2)
"
else
  echo "[$CHECKPOINT]" | python3 -m json.tool > "$CHECKPOINTS_FILE"
fi

echo "Checkpoint saved for $MARKET_DATE"

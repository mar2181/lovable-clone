#!/usr/bin/env bash
set -euo pipefail

ROOT="/home/mario/lovable-clone"
LOG_DIR="$ROOT/qa/logs"
mkdir -p "$LOG_DIR"

# If HS Solutions is not already responding, start the watchdog in the background for the QA run.
if ! timeout 1 bash -c '</dev/tcp/127.0.0.1/8799' >/dev/null 2>&1 || ! timeout 1 bash -c '</dev/tcp/127.0.0.1/3015' >/dev/null 2>&1; then
  echo "[$(date)] HS Solutions is not fully online; starting watchdog..." | tee -a "$LOG_DIR/daily-qa.log"
  nohup "$ROOT/scripts/watch-lovable.sh" >> "$LOG_DIR/watchdog-from-qa.log" 2>&1 &
  echo $! > "$LOG_DIR/watchdog-from-qa.pid"
fi

# Wait up to 90 seconds for frontend and worker.
for i in {1..45}; do
  if timeout 1 bash -c '</dev/tcp/127.0.0.1/8799' >/dev/null 2>&1 && timeout 1 bash -c '</dev/tcp/127.0.0.1/3015' >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

cd "$ROOT"
node qa/lovable-daily-qa.mjs 2>&1 | tee -a "$LOG_DIR/daily-qa.log"

#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/home/mario/lovable-clone"
WORKER_DIR="$APP_DIR/worker"
LOG_DIR="$APP_DIR/.lovable-startup-logs"
LOG_FILE="$LOG_DIR/worker.log"
PORT=8799
MAX_LOG_BYTES=$((50 * 1024 * 1024))   # 50 MB

mkdir -p "$LOG_DIR"
cd "$WORKER_DIR"

echo "============================================================"
echo "HS Solutions Worker"
echo "URL: http://localhost:$PORT"
echo "Started: $(date)"
echo "============================================================"

# Rotate log if it has grown beyond MAX_LOG_BYTES.
if [[ -f "$LOG_FILE" ]]; then
  size=$(stat -c%s "$LOG_FILE" 2>/dev/null || echo 0)
  if (( size > MAX_LOG_BYTES )); then
    ts=$(date +%Y%m%d-%H%M%S)
    mv "$LOG_FILE" "$LOG_FILE.$ts"
    echo "Rotated previous worker.log ($size bytes) to worker.log.$ts"
  fi
fi

# If something is already listening on $PORT, refuse to start a second copy.
# We deliberately do NOT silently kill the other process — racing two
# workers on the same port produced the bind-fail/EPIPE crash loops we saw
# in the 1.6 GB log. If you really mean to restart, kill the other one
# first.
if timeout 1 bash -c "</dev/tcp/127.0.0.1/$PORT" >/dev/null 2>&1; then
  echo "Worker port $PORT is already responding. Not starting a duplicate."
  echo "To stop the other one:  fuser -k ${PORT}/tcp"
  exec bash
fi

# Belt + suspenders: clean up any stale PID file pointing at a dead process
# whose port may have only just released.
if [[ -f "$LOG_DIR/worker.pid" ]]; then
  stale=$(cat "$LOG_DIR/worker.pid" 2>/dev/null || true)
  if [[ -n "${stale:-}" ]] && ! kill -0 "$stale" 2>/dev/null; then
    rm -f "$LOG_DIR/worker.pid"
  fi
fi

exec npx wrangler dev --ip 0.0.0.0 --port "$PORT"

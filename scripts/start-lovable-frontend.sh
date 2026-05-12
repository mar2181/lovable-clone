#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/home/mario/lovable-clone"
LOG_DIR="$APP_DIR/.lovable-startup-logs"
LOG_FILE="$LOG_DIR/frontend.log"
PORT=3015
WORKER_URL="http://localhost:8799"
MAX_LOG_BYTES=$((50 * 1024 * 1024))   # 50 MB

mkdir -p "$LOG_DIR"
cd "$APP_DIR"

echo "============================================================"
echo "HS Solutions Frontend"
echo "URL: http://localhost:$PORT/dashboard"
echo "Worker URL: $WORKER_URL"
echo "Started: $(date)"
echo "============================================================"

# Rotate log if it has grown beyond MAX_LOG_BYTES.
if [[ -f "$LOG_FILE" ]]; then
  size=$(stat -c%s "$LOG_FILE" 2>/dev/null || echo 0)
  if (( size > MAX_LOG_BYTES )); then
    ts=$(date +%Y%m%d-%H%M%S)
    mv "$LOG_FILE" "$LOG_FILE.$ts"
    echo "Rotated previous frontend.log ($size bytes) to frontend.log.$ts"
  fi
fi

if timeout 1 bash -c "</dev/tcp/127.0.0.1/$PORT" >/dev/null 2>&1; then
  echo "Frontend port $PORT is already responding. Not starting a duplicate."
  echo "Open: http://localhost:$PORT/dashboard"
  echo "To stop the other one:  fuser -k ${PORT}/tcp"
  exec bash
fi

if [[ -f "$LOG_DIR/frontend.pid" ]]; then
  stale=$(cat "$LOG_DIR/frontend.pid" 2>/dev/null || true)
  if [[ -n "${stale:-}" ]] && ! kill -0 "$stale" 2>/dev/null; then
    rm -f "$LOG_DIR/frontend.pid"
  fi
fi

exec env NEXT_PUBLIC_WORKER_URL="$WORKER_URL" npm run dev -- -H 0.0.0.0 --port "$PORT"

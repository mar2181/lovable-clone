#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/home/mario/lovable-clone"
WORKER_DIR="$APP_DIR/worker"
LOG_DIR="$APP_DIR/.lovable-startup-logs"
mkdir -p "$LOG_DIR"

FRONTEND_PORT=3015
WORKER_PORT=8799
FRONTEND_LOG="$LOG_DIR/frontend.log"
WORKER_LOG="$LOG_DIR/worker.log"
WATCHDOG_LOG="$LOG_DIR/watchdog.log"
FRONTEND_PID="$LOG_DIR/frontend.pid"
WORKER_PID="$LOG_DIR/worker.pid"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$WATCHDOG_LOG"
}

port_open() {
  local port="$1"
  timeout 1 bash -c "</dev/tcp/127.0.0.1/$port" >/dev/null 2>&1
}

pid_alive() {
  local file="$1"
  [[ -f "$file" ]] && kill -0 "$(cat "$file")" >/dev/null 2>&1
}

start_worker() {
  if port_open "$WORKER_PORT"; then
    log "Worker already responding on $WORKER_PORT"
    return 0
  fi
  log "Starting HS Solutions worker on $WORKER_PORT"
  (
    cd "$WORKER_DIR"
    exec npx wrangler dev --ip 0.0.0.0 --port "$WORKER_PORT"
  ) >> "$WORKER_LOG" 2>&1 &
  echo $! > "$WORKER_PID"
}

start_frontend() {
  if port_open "$FRONTEND_PORT"; then
    log "Frontend already responding on $FRONTEND_PORT"
    return 0
  fi
  log "Starting HS Solutions frontend on $FRONTEND_PORT"
  (
    cd "$APP_DIR"
    exec env NEXT_PUBLIC_WORKER_URL="http://localhost:$WORKER_PORT" npm run dev -- -H 0.0.0.0 --port "$FRONTEND_PORT"
  ) >> "$FRONTEND_LOG" 2>&1 &
  echo $! > "$FRONTEND_PID"
}

stop_all() {
  log "Stopping HS Solutions processes launched by watchdog"
  for f in "$FRONTEND_PID" "$WORKER_PID"; do
    if pid_alive "$f"; then
      kill "$(cat "$f")" >/dev/null 2>&1 || true
    fi
  done
}

trap stop_all INT TERM

log "HS Solutions watchdog booting"
start_worker
sleep 4
start_frontend

while true; do
  if ! port_open "$WORKER_PORT"; then
    log "Worker is down; restarting"
    start_worker
  fi
  if ! port_open "$FRONTEND_PORT"; then
    log "Frontend is down; restarting"
    start_frontend
  fi
  sleep 120
done

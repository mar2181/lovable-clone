#!/usr/bin/env bash
set -euo pipefail

cd /home/mario/lovable-clone

echo "============================================================"
echo "HS Solutions Frontend"
echo "URL: http://localhost:3015/dashboard"
echo "Worker URL: http://localhost:8799"
echo "Started: $(date)"
echo "============================================================"

if timeout 1 bash -c '</dev/tcp/127.0.0.1/3015' >/dev/null 2>&1; then
  echo "Frontend port 3015 is already responding. Not starting a duplicate."
  echo "Open: http://localhost:3015/dashboard"
  exec bash
fi

NEXT_PUBLIC_WORKER_URL=http://localhost:8799 npm run dev -- -H 0.0.0.0 --port 3015

#!/usr/bin/env bash
set -euo pipefail

cd /home/mario/lovable-clone/worker

echo "============================================================"
echo "HS Solutions Worker"
echo "URL: http://localhost:8799"
echo "Started: $(date)"
echo "============================================================"

if timeout 1 bash -c '</dev/tcp/127.0.0.1/8799' >/dev/null 2>&1; then
  echo "Worker port 8799 is already responding. Not starting a duplicate."
  echo "Leave this window open, or close it if another worker terminal is already running."
  exec bash
fi

npx wrangler dev --ip 0.0.0.0 --port 8799

#!/usr/bin/env bash
set -euo pipefail

cd /home/mario/lovable-clone
mkdir -p .lovable-startup-logs

echo "============================================================"
echo "HS Solutions Auto-Start Watchdog"
echo "Frontend: http://localhost:3015/dashboard"
echo "Worker:   http://localhost:8799/health"
echo "Started:  $(date)"
echo "Logs:     /home/mario/lovable-clone/.lovable-startup-logs"
echo "============================================================"
echo "Leave this terminal open. It will restart HS Solutions if it crashes."
echo

exec /home/mario/lovable-clone/scripts/watch-lovable.sh

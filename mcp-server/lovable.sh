#!/bin/bash
# lovable.sh — CLI wrapper for Lovable Clone Worker API
# Usage: lovable.sh <command> [args...]

WORKER_URL="${WORKER_URL:-http://192.168.1.232:8788}"
API_KEY="${MCP_API_KEY:-d821bb15d17bd44b19f41f0d68925eb917724a18b82521b1b3d3da809f9b1c73}"

api() {
  local method="$1" path="$2"
  shift 2
  curl -s -X "$method" "$WORKER_URL$path" \
    -H "Content-Type: application/json" \
    -H "X-API-Key: $API_KEY" \
    -H "X-User-Id: mcp-service-user" \
    "$@"
}

case "$1" in
  health)
    api GET /health
    ;;

  projects)
    api GET /api/projects
    ;;

  create)
    local name="$2" desc="$3"
    api POST /api/projects -d "{\"name\":\"$name\",\"description\":\"$desc\"}"
    ;;

  files)
    local pid="$2" ver="$3"
    if [ -n "$ver" ]; then
      api GET "/api/versions/$pid/$ver"
    else
      api GET "/api/versions/$pid/latest"
    fi
    ;;

  versions)
    local pid="$2"
    api GET "/api/versions/$pid"
    ;;

  chat)
    local pid="$2" prompt="$3" model="${4:-qwen/qwen3-coder}"
    curl -s -N -X POST "$WORKER_URL/api/chat/$pid" \
      -H "Content-Type: application/json" \
      -H "X-API-Key: $API_KEY" \
      -H "X-User-Id: mcp-service-user" \
      -d "{\"prompt\":\"$prompt\",\"model\":\"$model\",\"contextFiles\":{}}"
    ;;

  push)
    local pid="$2" repo="$3"
    # Get files first
    local files=$(api GET "/api/versions/$pid/latest" | jq '.version.files')
    api POST /api/github/push -d "{\"repoName\":\"$repo\",\"files\":$files,\"projectId\":\"$pid\"}"
    ;;

  deploy)
    local pid="$2"
    local files=$(api GET "/api/versions/$pid/latest" | jq '.version.files')
    api POST /api/vercel/deploy -d "{\"files\":$files,\"projectId\":\"$pid\"}"
    ;;

  export)
    local pid="$2" ver="${3:-latest}"
    if [ "$ver" = "latest" ]; then
      ver=$(api GET "/api/versions/$pid/latest" | jq -r '.version.version')
    fi
    curl -s -o "/tmp/lovable-export-$pid-v$ver.zip" \
      -H "X-API-Key: $API_KEY" \
      -H "X-User-Id: mcp-service-user" \
      "$WORKER_URL/api/export/$pid/$ver"
    echo "Exported to /tmp/lovable-export-$pid-v$ver.zip"
    ;;

  *)
    echo "Usage: lovable.sh <command> [args]"
    echo ""
    echo "Commands:"
    echo "  health                          Check worker status"
    echo "  projects                        List all projects"
    echo "  create <name> [description]     Create a new project"
    echo "  files <projectId> [version]     Get project files"
    echo "  versions <projectId>            List version history"
    echo "  chat <projectId> <prompt> [model]  Send message to AI"
    echo "  push <projectId> <repoName>     Push to GitHub"
    echo "  deploy <projectId>              Deploy to Vercel"
    echo "  export <projectId> [version]    Export as ZIP"
    ;;
esac

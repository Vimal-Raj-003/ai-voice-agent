#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

uvicorn server:app --host 0.0.0.0 --port 8000 --reload &
SERVER_PID=$!
trap "kill $SERVER_PID 2>/dev/null || true" EXIT

python agent.py start

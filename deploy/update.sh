#!/usr/bin/env bash
# Pull latest main, rebuild, and roll the stack.
# Run from repo root on the VPS:  ./deploy/update.sh

set -euo pipefail

cd "$(dirname "$0")/.."

echo "→ Fetching latest main..."
git fetch origin
git reset --hard origin/main

echo "→ Rebuilding images..."
docker compose build --pull

echo "→ Applying any new Prisma migrations..."
docker compose run --rm --entrypoint sh dashboard -c "npx prisma migrate deploy"

echo "→ Rolling containers..."
docker compose up -d

echo "→ Pruning dangling images..."
docker image prune -f

echo "✓ Update complete."
docker compose ps

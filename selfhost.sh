#!/bin/sh
# Install or upgrade a self-hosted Supalens.
#
#   ./selfhost.sh
#
# First run: asks for the address and a model API key, generates every other secret into
# .env, then builds and starts the stack. Later runs keep .env and just rebuild and restart
# (migrations are applied automatically). The only requirement is Docker.
set -eu
cd "$(dirname "$0")"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required: https://docs.docker.com/get-docker/" >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2 is required (docker compose …)." >&2
  exit 1
fi

if [ ! -f .env ]; then
  printf "Address people will open [http://localhost:8080]: "
  read -r APP_URL || APP_URL=""
  APP_URL=${APP_URL:-http://localhost:8080}
  printf "Anthropic API key (sk-ant-…, or leave empty to use another model provider — see .env): "
  read -r ANTHROPIC_API_KEY || ANTHROPIC_API_KEY=""

  if command -v node >/dev/null 2>&1; then
    APP_URL="$APP_URL" ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" node scripts/selfhost-init.mjs
  else
    # no Node on the host: run the generator in a throwaway container
    docker run --rm -v "$PWD":/work -w /work \
      -e APP_URL="$APP_URL" -e ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
      node:24-bookworm-slim node scripts/selfhost-init.mjs
  fi
fi

docker compose up --build -d

APP_URL=$(grep '^NEXT_PUBLIC_APP_URL=' .env | cut -d= -f2-)
echo
echo "Supalens is starting at $APP_URL"
echo "Open it to create the administrator account. Logs: docker compose logs -f web"

#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR=/home/ubuntu/miniapp
COMPOSE_FILE=deploy/tencent-hk/docker-compose.yml

cd "$PROJECT_DIR"
git checkout master
git pull --ff-only origin master
sudo docker compose -f "$COMPOSE_FILE" up -d --build
sudo docker compose -f "$COMPOSE_FILE" ps

for attempt in 1 2 3 4 5 6; do
  if curl --fail --silent http://127.0.0.1/api/health >/dev/null; then
    echo "Deployment healthy."
    exit 0
  fi
  sleep 5
done

sudo docker compose -f "$COMPOSE_FILE" logs --tail=80 app redis mysql
exit 1

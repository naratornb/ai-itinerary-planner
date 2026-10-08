#!/usr/bin/env bash
# Replay the whole schema into a disposable local Postgres and run the
# package-editor persistence checks. Never touches Supabase.
#
# Requires Docker running. No host psql needed — psql runs inside the container.
#
#   ./apps/api/tests/local_verify/run.sh
#
# Exits non-zero on the first SQL error (ON_ERROR_STOP), so a failure is loud.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
CONTAINER=pkg-editor-verify
IMAGE=postgres:15-alpine
KEEP="${KEEP:-0}"

cleanup() {
  if [ "$KEEP" = "1" ]; then
    echo "KEEP=1 — leaving container '$CONTAINER' up. Remove with: docker rm -f $CONTAINER"
  else
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

docker info >/dev/null 2>&1 || { echo "Docker is not running. Start Docker Desktop and retry."; exit 1; }

docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
echo "==> starting $IMAGE"
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=verify -e POSTGRES_DB=verify "$IMAGE" >/dev/null

printf '==> waiting for postgres'
for _ in $(seq 1 30); do
  if docker exec "$CONTAINER" pg_isready -U postgres -d verify >/dev/null 2>&1; then break; fi
  printf '.'
  sleep 1
done
echo

psql_file() {
  docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d verify -f - < "$1"
}

echo "==> applying Supabase shim"
psql_file "$REPO_ROOT/apps/api/tests/local_verify/00_supabase_shim.sql" >/dev/null

echo "==> applying migrations"
for f in "$REPO_ROOT"/supabase/migrations/*.sql; do
  echo "    $(basename "$f")"
  psql_file "$f" >/dev/null
done

echo "==> running package_editor_persistence.sql"
echo
psql_file "$REPO_ROOT/apps/api/tests/package_editor_persistence.sql"
echo
echo "==> done. Every statement above ran; a failed assertion aborts with ON_ERROR_STOP."

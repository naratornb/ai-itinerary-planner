#!/bin/sh
# Start api (:5001) + web (:3000). Ctrl-C stops both.
cd "$(dirname "$0")"
trap 'kill 0' INT TERM
# Prefer the project venv — the global uvicorn may lack the API's deps (e.g. python-multipart).
(cd apps/api && "${UVICORN:-.venv/bin/uvicorn}" app.main:app --port 5001 --reload) &
(cd apps/web && npm run dev) &
wait

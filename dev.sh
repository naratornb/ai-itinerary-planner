#!/bin/sh
# Start api (:5001) + web (:3000). Ctrl-C stops both.
cd "$(dirname "$0")"
trap 'kill 0' INT TERM
(cd apps/api && flask run --port 5001) &
(cd apps/web && npm run dev) &
wait

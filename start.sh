#!/bin/sh
# Container entrypoint for the QA Studio web service.
#
# Two responsibilities:
#   1. Hydrate Cursor CLI credentials from the Render Secret File
#      (uploaded once via the Render dashboard) so cursor-agent can
#      talk to Cursor's inference API without an interactive OAuth
#      flow that the headless container can never complete.
#   2. exec uvicorn so PID 1 stays attached to the Python process and
#      Render's SIGTERM on redeploy reaches the worker (a child shell
#      would swallow it and force a kill-after-grace).
#
# When /etc/secrets/cursor-auth.tgz is missing the script logs that
# fact and starts uvicorn anyway. The orchestrator's auto-discovery
# (backend/routers/deps.py:_discover_cursor_bin) will still find the
# binary, but every Cursor call will fail authentication; the
# orchestrator's per-request fallback then routes the run to Gemini.

set -e

SECRET="/etc/secrets/cursor-auth.tgz"
if [ -f "$SECRET" ]; then
  mkdir -p "$HOME/.cursor"
  # `tar -C` cd's into the destination first so the archive contents
  # land directly inside ~/.cursor regardless of how it was packed.
  if tar -xzf "$SECRET" -C "$HOME/.cursor" 2>/dev/null; then
    echo "[boot] Cursor credentials hydrated from $SECRET"
  else
    echo "[boot] WARNING: failed to extract $SECRET. Cursor calls will fall back to Gemini."
  fi
else
  echo "[boot] $SECRET missing - cursor-agent will be unauthenticated; orchestrator will route everything to Gemini."
fi

exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-8080}"

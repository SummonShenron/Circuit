#!/usr/bin/env bash
set -e

# Resolve script root directory
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON="$ROOT/.venv/bin/python"

# Verify virtual environment existence
if [ ! -f "$PYTHON" ]; then
    echo "Error: Project Python was not found at $PYTHON. Create or select the .venv environment first." >&2
    exit 1
fi

# Check if ports 8010 or 8090 are currently in use
OCCUPIED=""
if command -v lsof >/dev/null 2>&1; then
    if lsof -Pi :8010 -sTCP:LISTEN -t >/dev/null 2>&1; then OCCUPIED="$OCCUPIED 8010"; fi
    if lsof -Pi :8090 -sTCP:LISTEN -t >/dev/null 2>&1; then OCCUPIED="$OCCUPIED 8090"; fi
fi

if [ -n "$OCCUPIED" ]; then
    echo "Error: Port(s)$OCCUPIED are already in use. Run ./stop-dev.sh, then try again." >&2
    exit 1
fi

# Start backend and frontend in background jobs
(cd "$ROOT/backend" && "$PYTHON" run.py) &
(cd "$ROOT/frontend" && npm run dev) &

echo "Starting backend at http://127.0.0.1:8010 with Uvicorn reload."
echo "Starting frontend at http://127.0.0.1:8090 with Vite hot reload."
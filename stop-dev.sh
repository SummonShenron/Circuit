#!/usr/bin/env bash

PORTS=(8010 8090)
FOUND=0

for PORT in "${PORTS[@]}"; do
    # Locate PIDs listening on the specified TCP port
    PIDS=$(lsof -ti :"$PORT" -sTCP:LISTEN 2>/dev/null)

    if [ -n "$PIDS" ]; then
        FOUND=1
        for PID in $PIDS; do
            # Retrieve process name
            PNAME=$(ps -p "$PID" -o comm= 2>/dev/null || echo "Process")
            
            if kill -9 "$PID" 2>/dev/null; then
                echo "Stopped ${PNAME} (PID: ${PID}) on port ${PORT}."
            else
                echo "Warning: Could not kill process ${PID} listening on port ${PORT}." >&2
            fi
        done
    fi
done

if [ "$FOUND" -eq 0 ]; then
    echo "No Circuit development servers are listening on ports 8010 or 8090."
fi
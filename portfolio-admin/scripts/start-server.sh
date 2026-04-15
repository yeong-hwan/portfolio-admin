#!/bin/bash
# Start portfolio-admin server in background
# Usage: ./scripts/start-server.sh [start|stop|status]

export PATH=/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:$PATH
DIR="$(cd "$(dirname "$0")/.." && pwd)"
PIDFILE="$DIR/data/server.pid"
LOGFILE="$DIR/data/server.log"

mkdir -p "$DIR/data"

case "${1:-start}" in
  start)
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      echo "Server already running (PID $(cat "$PIDFILE"))"
      exit 0
    fi
    cd "$DIR"
    nohup npx tsx server/index.ts >> "$LOGFILE" 2>&1 &
    echo $! > "$PIDFILE"
    echo "Server started (PID $!), log: $LOGFILE"
    ;;
  stop)
    if [ -f "$PIDFILE" ]; then
      kill "$(cat "$PIDFILE")" 2>/dev/null
      rm -f "$PIDFILE"
      echo "Server stopped"
    else
      echo "No PID file found"
    fi
    ;;
  status)
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      echo "Running (PID $(cat "$PIDFILE"))"
    else
      echo "Not running"
      rm -f "$PIDFILE" 2>/dev/null
    fi
    ;;
  *)
    echo "Usage: $0 {start|stop|status}"
    ;;
esac

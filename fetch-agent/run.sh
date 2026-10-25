#!/bin/sh
# Keeps the council agents running; restarts on crash. Logs to /tmp/council-agent.log.
cd "$(dirname "$0")"
while :; do
  .venv/bin/python agent.py >> /tmp/council-agent.log 2>&1
  echo "[watchdog] agent.py exited $? at $(date -u +%H:%M:%S); restarting in 5s" >> /tmp/council-agent.log
  sleep 5
done

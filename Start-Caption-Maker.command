#!/bin/bash
cd "$(dirname "$0")"

# If invoked from Desktop or another location, resolve the project root
PROJECT_DIR="/Users/rohit/Desktop/Local Project V2/Caption Maker"
if [ -d "$PROJECT_DIR" ]; then
  cd "$PROJECT_DIR"
fi

echo "=========================================="
echo "    Caption Maker - Web & Desktop App    "
echo "=========================================="

# Check if Caption Maker stack is already answering on port 5180
if curl -s -m 1 http://localhost:5180/api/health >/dev/null 2>&1; then
  echo "✓ Caption Maker server is already running."
else
  echo "Starting Caption Maker dev server..."
  npm run dev &
  # Wait for server readiness
  for i in {1..30}; do
    if curl -s -m 1 http://localhost:5180/api/health >/dev/null 2>&1; then
      echo "✓ Dev server is online!"
      break
    fi
    sleep 1
  done
fi

# Open web app in default browser
echo "Opening Web App in browser: http://localhost:5173"
open "http://localhost:5173"

# Open desktop app
if [ -d "/Applications/Caption Maker.app" ]; then
  echo "Opening Desktop Application..."
  open "/Applications/Caption Maker.app"
fi

echo "=========================================="
echo "Caption Maker is active and ready to use!"
echo "=========================================="

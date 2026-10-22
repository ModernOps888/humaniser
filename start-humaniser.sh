#!/usr/bin/env bash
set -e
echo "============================================================================"
echo "  HUMANISER v2.5 — 100% Client-Side AI Text Humanizer & Detector"
echo "  Serving at http://localhost:3000"
echo "============================================================================"
if command -v python3 >/dev/null 2>&1; then
  python3 -m http.server 3000
elif command -v python >/dev/null 2>&1; then
  python -m http.server 3000
elif command -v npx >/dev/null 2>&1; then
  npx --yes serve . -l 3000
else
  echo "Please install Python 3 or Node.js to serve ES modules locally."
  exit 1
fi

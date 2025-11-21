#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

# Prefer python3 but fall back to python; allow override via environment
PYTHON_BIN="${PYTHON_BIN:-$(command -v python3 || command -v python)}"
if [[ -z "$PYTHON_BIN" ]]; then
  echo "No python interpreter found in PATH."
  exit 1
fi

# Create a virtual environment if missing, then activate it
if [[ ! -d ".venv" ]]; then
  "$PYTHON_BIN" -m venv .venv
fi

source .venv/bin/activate

# Ensure dependencies are available
pip install -r requirements.txt

# Start the Flask app on port 8888
exec .venv/bin/python app.py

#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")"

# Prefer python3 but fall back to python; allow override via environment
PYTHON_BIN="${PYTHON_BIN:-$(command -v python3 || command -v python)}"
if [[ -z "$PYTHON_BIN" ]]; then
  echo "Error: Python not found."
  echo "Please install Python 3."
  echo "  - On macOS: brew install python3"
  echo "  - On Linux: sudo apt install python3 (or equivalent for your distro)"
  echo "  - Or download from https://www.python.org/downloads/"
  exit 1
fi

# Create a virtual environment if missing, then activate it
# Create a virtual environment if missing, then activate it
if [[ ! -d ".venv" ]]; then
  echo "Creating virtual environment..."
  "$PYTHON_BIN" -m venv .venv || { echo "Error: Failed to create virtual environment."; exit 1; }
fi

echo "Activating virtual environment..."
source .venv/bin/activate || { echo "Error: Failed to activate virtual environment."; exit 1; }

# Ensure dependencies are available
echo "Installing dependencies..."
pip install -r requirements.txt || { echo "Error: Failed to install dependencies."; exit 1; }

# Start the Flask app on port 8888
echo "Starting application..."
exec .venv/bin/python app.py || { echo "Error: Application exited with an error."; exit 1; }

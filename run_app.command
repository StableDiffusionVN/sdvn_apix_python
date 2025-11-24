#!/bin/zsh
cd "$(dirname "$0")"
# Prefer python3 but fall back to python; allow overriding via env
PYTHON_BIN="${PYTHON_BIN:-$(command -v python3 || command -v python)}"
if [[ -z "$PYTHON_BIN" ]]; then
  echo "Error: Python not found."
  echo "Please install Python 3."
  echo "  - On macOS: brew install python3"
  echo "  - Or download from https://www.python.org/downloads/"
  read -k 1 "key?Press any key to exit..."
  exit 1
fi

# Create a virtual environment if missing, then activate it
# Create a virtual environment if missing, then activate it
if [[ ! -d ".venv" ]]; then
  echo "Creating virtual environment..."
  "$PYTHON_BIN" -m venv .venv || { echo "Error: Failed to create virtual environment."; read -k 1 "key?Press any key to exit..."; exit 1; }
fi

echo "Activating virtual environment..."
source .venv/bin/activate || { echo "Error: Failed to activate virtual environment."; read -k 1 "key?Press any key to exit..."; exit 1; }

# Ensure dependencies are available (skip reinstall if up-to-date)
echo "Installing dependencies..."
pip install -r requirements.txt || { echo "Error: Failed to install dependencies."; read -k 1 "key?Press any key to exit..."; exit 1; }

# Start the Flask app on port 8888
echo "Starting application..."
.venv/bin/python app.py

if [[ $? -ne 0 ]]; then
  echo "Error: Application crashed or exited with an error."
  read -k 1 "key?Press any key to exit..."
  exit 1
fi

echo "Application finished successfully."
read -k 1 "key?Press any key to exit..."

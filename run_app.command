# /opt/miniconda3/bin/python is required by the user
#!/bin/zsh
cd "$(dirname "$0")"
PYTHON_BIN="/opt/miniconda3/bin/python"

# Create a virtual environment if missing, then activate it
if [[ ! -d ".venv" ]]; then
  "$PYTHON_BIN" -m venv .venv
fi

source .venv/bin/activate

# Ensure dependencies are available (skip reinstall if up-to-date)
pip install -r requirements.txt

# Start the Flask app on port 8888
exec .venv/bin/python app.py

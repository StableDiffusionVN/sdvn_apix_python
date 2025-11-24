@echo off
setlocal

cd /d "%~dp0"

if defined PYTHON_BIN goto :found_python

for /f "delims=" %%P in ('where python3 2^>nul') do (
  set "PYTHON_BIN=%%~P"
  goto :found_python
)
for /f "delims=" %%P in ('where python 2^>nul') do (
  set "PYTHON_BIN=%%~P"
  goto :found_python
)
for /f "delims=" %%P in ('py -3 -c "import sys; print(sys.executable)" 2^>nul') do (
  set "PYTHON_BIN=%%~P"
  goto :found_python
)

echo Error: Python not found.
echo Please install Python from https://www.python.org/downloads/
echo or install it via the Microsoft Store.
echo IMPORTANT: When installing, make sure to check "Add Python to PATH".
pause
exit /b 1

:found_python
if not exist ".venv" (
  echo Creating virtual environment...
  "%PYTHON_BIN%" -m venv .venv
  if errorlevel 1 (
    echo Error: Failed to create virtual environment.
    pause
    exit /b 1
  )
)

echo Activating virtual environment...
call .venv\Scripts\activate.bat
if errorlevel 1 (
  echo Error: Failed to activate virtual environment.
  pause
  exit /b 1
)

echo Installing dependencies...
pip install -r requirements.txt
if errorlevel 1 (
  echo Error: Failed to install dependencies.
  pause
  exit /b 1
)

echo Starting application...
call .venv\Scripts\python.exe app.py
if errorlevel 1 (
  echo Error: Application crashed or exited with an error.
  pause
  exit /b 1
)

echo Application finished successfully.
pause
endlocal

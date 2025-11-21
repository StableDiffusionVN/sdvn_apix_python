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

echo No python interpreter found in PATH.
exit /b 1

:found_python
if not exist ".venv" (
  "%PYTHON_BIN%" -m venv .venv
)

call .venv\Scripts\activate.bat

pip install -r requirements.txt

call .venv\Scripts\python.exe app.py
endlocal

@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 LTS from https://nodejs.org/
  pause
  exit /b 1
)
if not exist "node_modules\ws\package.json" (
  echo Installing server dependencies. Internet connection is required.
  call npm.cmd ci
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
echo Open http://localhost:5331/ in Chrome or Edge.
node tools\serve.mjs
pause

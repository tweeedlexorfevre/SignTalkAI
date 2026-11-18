@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 LTS from https://nodejs.org/ and run this file again.
  pause
  exit /b 1
)
if not exist "node_modules\ws\package.json" (
  echo Installing server dependencies. Internet connection is required.
  call npm.cmd ci
  if errorlevel 1 (
    echo Installation failed. Read the message above.
    pause
    exit /b 1
  )
)
cd web
if not exist "node_modules\vite\package.json" (
  echo Installing dependencies. Internet connection is required.
  call npm.cmd ci
  if errorlevel 1 (
    echo Installation failed. Read the message above.
    pause
    exit /b 1
  )
)
echo Open http://localhost:5330/ in Chrome or Edge.
call npm.cmd run dev
pause

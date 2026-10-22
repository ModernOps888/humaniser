@echo off
title Humaniser v2.5 — Local Desktop Server
echo ============================================================================
echo   HUMANISER v2.5 — 100%% Client-Side AI Text Humanizer ^& Detector
echo   Opening http://localhost:3000 in your default browser...
echo ============================================================================
start http://localhost:3000
where python >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  python -m http.server 3000
  goto :eof
)
where npx >nul 2>nul
if %ERRORLEVEL% EQU 0 (
  npx --yes serve . -l 3000
  goto :eof
)
echo Either Python 3 or Node.js (npx) is required to serve ES modules locally.
pause

@echo off
cd /d "%~dp0"
echo.
echo   INTO THE VOID - Phase 1 server
echo   If chat/Add do nothing, you may have an OLD server still running.
echo   Close any other terminal running the site, then run this again.
echo.
echo   Open http://localhost:3000/index.html
echo   Press Ctrl+C to stop.
echo.
"C:\Program Files\nodejs\npm.cmd" start

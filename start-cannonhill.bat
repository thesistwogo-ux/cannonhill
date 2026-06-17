@echo off
title Cannonhill server
echo.
echo  Starting Cannonhill server...
echo.
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do set IP=%%a
set IP=%IP: =%
echo  On THIS PC open:        http://localhost:8777
echo  On your iPhone open:    http://%IP%:8777   (same Wi-Fi)
echo.
echo  Leave this window open while you play. Press Ctrl+C to stop.
echo.
node "%~dp0server.js"
pause

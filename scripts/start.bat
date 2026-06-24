@echo off
setlocal

set PORT=5000
if "%DEPLOY_RUN_PORT%"=="" set DEPLOY_RUN_PORT=%PORT%

echo Starting HTTP service on port %DEPLOY_RUN_PORT% for deploy...
set PORT=%DEPLOY_RUN_PORT%
node dist\server.js

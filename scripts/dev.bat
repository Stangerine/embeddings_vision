@echo off
setlocal

set PORT=3000
if "%DEPLOY_RUN_PORT%"=="" set DEPLOY_RUN_PORT=%PORT%

echo Starting HTTP service on port %DEPLOY_RUN_PORT% for dev...
set PORT=%DEPLOY_RUN_PORT%
pnpm tsx watch src/server.ts

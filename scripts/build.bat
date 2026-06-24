@echo off
setlocal

echo Installing dependencies...
pnpm install --prefer-frozen-lockfile --prefer-offline --loglevel debug --reporter=append-only

echo Building the Next.js project...
pnpm next build

echo Bundling server with tsup...
pnpm tsup src/server.ts --format cjs --platform node --target node20 --outDir dist --no-splitting --no-minify

echo Copying Python backend...
if exist dist\backend rmdir /s /q dist\backend
xcopy /E /I /Q backend dist\backend

echo Build completed successfully!

#!/bin/bash
# Compile TypeScript -> dist/ on the instance, after `npm install` (which, with
# NPM_USE_PRODUCTION=false, includes typescript + @types). Runs on every deploy.
set -euo pipefail

cd /var/app/staging

echo "[hook] building TypeScript"
export NODE_OPTIONS="--max-old-space-size=1536"
npm run build

echo "[hook] build complete: $(ls -1 dist | head -1) ..."

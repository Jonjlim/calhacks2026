#!/usr/bin/env bash
# Bundles and runs scripts/e2e-live.mts against the deployment in .env.local (Node 20 cannot run TS directly).
set -euo pipefail
cd "$(dirname "$0")/.."
npx esbuild scripts/e2e-live.mts --bundle --platform=node --format=esm --outfile=scripts/.e2e.bundle.mjs --log-level=error
trap 'rm -f scripts/.e2e.bundle.mjs' EXIT
node --env-file=.env.local scripts/.e2e.bundle.mjs

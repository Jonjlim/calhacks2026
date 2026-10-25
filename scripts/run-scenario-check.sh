#!/usr/bin/env bash
# Bundles and runs scripts/scenario-check.mts against the deployment in .env.local (Node 20 cannot run TS directly).
set -euo pipefail
cd "$(dirname "$0")/.."
npx esbuild scripts/scenario-check.mts --bundle --platform=node --format=esm --outfile=scripts/.scenario.bundle.mjs --log-level=error
trap 'rm -f scripts/.scenario.bundle.mjs' EXIT
node --env-file=.env.local scripts/.scenario.bundle.mjs "$@"

#!/usr/bin/env bash
# setup-hosted-convex.sh
#
# One-shot setup for the hosted Convex backend (team/project + dev + prod
# deployments, auth env vars, prod deploy).
#
# Required env knobs (set these before running):
#   PROJECT_NAME       — Convex project name.            default: unwrap
#   TEAM_SLUG          — your Convex team slug.          required only if you
#                                                              belong to >1 team
#   SITE_URL_DEV       — web origin for the dev auth     default: http://localhost:3000
#   SITE_URL_PROD      — web origin for prod auth        required (your Vercel URL)
#                                                  no default: must be HTTPS
#
# Idempotency: `convex login` and `convex project create` are not idempotent;
# the auth/env steps are.

set -euo pipefail

PROJECT_NAME="${PROJECT_NAME:-unwrap}"
TEAM_SLUG="${TEAM_SLUG:-}"
SITE_URL_DEV="${SITE_URL_DEV:-http://localhost:3000}"
SITE_URL_PROD="${SITE_URL_PROD:-}"

step() { printf "\n\033[1;36m▶ %s\033[0m\n" "$*"; }

if [ -z "$SITE_URL_PROD" ]; then
  echo "SITE_URL_PROD is not set. Set it to your Vercel URL (HTTPS, no trailing slash) before running prod steps."
  echo "Example: SITE_URL_PROD=https://unwrap.vercel.app ./scripts/setup-hosted-convex.sh"
  exit 1
fi

step "1/9 Login (browser will open; device-code paste mode is used below if no GUI)"
if [ -n "${CONVEX_USE_PASTE_LOGIN:-}" ]; then
  npx convex login --login-flow paste --no-open
else
  npx convex login
fi

step "2/9 Create hosted project '$PROJECT_NAME'"
if [ -n "$TEAM_SLUG" ]; then
  npx convex project create "$PROJECT_NAME" --team "$TEAM_SLUG"
else
  npx convex project create "$PROJECT_NAME"
fi

step "3/9 Create dev deployment + select it (writes .env.local)"
npx convex deployment create dev --type dev --select

step "4/9 Push schema + code to dev"
npx convex dev --once

step "5/9 Provision @convex-dev/auth on dev (SITE_URL=$SITE_URL_DEV)"
npx @convex-dev/auth --web-server-url "$SITE_URL_DEV"

step "6/9 Create prod deployment"
npx convex deployment create prod --type prod

step "7/9 Provision @convex-dev/auth on prod (SITE_URL=$SITE_URL_PROD)"
npx @convex-dev/auth --prod --web-server-url "$SITE_URL_PROD"

step "8/9 Deploy to prod"
# CONVEX_DEPLOYMENT env var selects the project; --yes skips the prod-confirm prompt.
npx convex deploy --yes

step "9/9 Print Next.js client env values for Vercel:"
echo "(CONVEX_DEPLOYMENT points at the project's dev deployment; for Vercel,"
echo " paste the prod values shown below into the prod environment.)"
grep -E '^(CONVEX_DEPLOYMENT|NEXT_PUBLIC_CONVEX_URL|NEXT_PUBLIC_CONVEX_SITE_URL)=' .env.local
echo
echo "Prod URLs (use these in Vercel prod env):"
echo "  NEXT_PUBLIC_CONVEX_URL=\$(npx convex dashboard --prod --no-open 2>/dev/null | grep -oE 'https://[^/]+\.convex\.cloud' | head -1)"
echo "  NEXT_PUBLIC_CONVEX_SITE_URL=<prod-deployment-name>.convex.site"

cat <<'NEXT'

Hosted setup complete. To deploy the Next.js app on Vercel:

  vercel login
  vercel link
  vercel env add CONVEX_DEPLOYMENT          production   # paste from .env.local
  vercel env add NEXT_PUBLIC_CONVEX_URL     production   # paste from .env.local
  vercel env add NEXT_PUBLIC_CONVEX_SITE_URL production  # paste from .env.local
  vercel --prod

NEXT

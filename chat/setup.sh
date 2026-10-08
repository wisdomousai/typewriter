#!/bin/sh
# Once, before the chat's first deploy: a Turnstile widget for its captcha, the Worker's two
# secrets (TURNSTILE_SECRET, from the widget, and PASS_KEY, to sign passes with), and the
# widget's site key into .env.production for the page. Uses wrangler's login (or
# CLOUDFLARE_API_TOKEN, with Turnstile edit rights), on CLOUDFLARE_ACCOUNT_ID or the login's
# account. DOMAINS lists where the page is served (comma separated).
#
#   DOMAINS=you.github.io sh chat/setup.sh
set -e
cd "$(dirname "$0")/.."
WRANGLER="npx wrangler"
CONFIG=chat/wrangler.jsonc
DOMAINS=${DOMAINS:-wisdomousai.github.io}

$WRANGLER whoami >/dev/null 2>&1 # refreshes the login's token
ACCOUNT=${CLOUDFLARE_ACCOUNT_ID:-$($WRANGLER whoami 2>/dev/null | grep -oE '[0-9a-f]{32}' | head -1)}
if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
  for f in "$HOME/Library/Preferences/.wrangler/config/default.toml" "$HOME/.config/.wrangler/config/default.toml" \
    "$HOME/.wrangler/config/default.toml"; do
    [ -f "$f" ] && TOKEN=$(sed -n 's/^oauth_token = "\(.*\)"/\1/p' "$f") && break
  done
else
  TOKEN=$CLOUDFLARE_API_TOKEN
fi
[ -n "$ACCOUNT" ] && [ -n "$TOKEN" ] || { echo "Log in first: npx wrangler login" >&2; exit 1; }

domains=$(printf '%s' "$DOMAINS" | sed 's/[^,][^,]*/"&"/g')
widget=$(curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT/challenges/widgets" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"name\":\"typewriter-chat\",\"mode\":\"managed\",\"domains\":[$domains]}")
field() {
  printf '%s' "$widget" | node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>{const r=JSON.parse(s);
    if(!r.success){console.error(JSON.stringify(r.errors));process.exit(1)}process.stdout.write(r.result[process.argv[1]])})' "$1"
}
sitekey=$(field sitekey)
field secret | $WRANGLER secret put TURNSTILE_SECRET --config $CONFIG >/dev/null
openssl rand -base64 32 | tr -d '\n' | $WRANGLER secret put PASS_KEY --config $CONFIG >/dev/null

touch .env.production
grep -v '^PUBLIC_TURNSTILE_SITEKEY=' .env.production > .env.production.tmp || true
echo "PUBLIC_TURNSTILE_SITEKEY=$sitekey" >> .env.production.tmp
mv .env.production.tmp .env.production
echo "Turnstile widget $sitekey for $DOMAINS; secrets set on the Worker; site key in .env.production."

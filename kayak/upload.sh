#!/usr/bin/env bash
# Publish the kayak game to paddlesnitch.com/games/kayak/ (paddlesnitch.com/game
# redirects there). Copies kayak/ and shared/ side by side into the paddlesnitch
# assets bucket, so the game's ../shared/ imports resolve, then clears the CDN
# cache. Needs an AWS SSO session: aws sso login --profile paddlesnitch
set -euo pipefail

PROFILE="${AWS_PROFILE:-paddlesnitch}"
BUCKET="paddlesnitch-assets-prod"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Browsers re-check after 5 minutes; the invalidation below covers the CDN.
CACHE="public, max-age=300"

aws s3 sync "$ROOT/kayak/" "s3://$BUCKET/games/kayak/" --delete \
  --exclude "upload.sh" --exclude "index.html" --exclude ".*" --cache-control "$CACHE" --profile "$PROFILE"

# index.html goes up separately with a paddlesnitch pageview beacon added
# before </head>, so visits show in the paddlesnitch-app dashboard (pageviews
# by path). Only the uploaded copy gets it; the game's own file stays clean.
# Same session id key (tt_sid) as the paddlesnitch app, no cookies, no PII.
BEACON='<script>try{var k="tt_sid",s=sessionStorage.getItem(k);if(!s){s=(crypto.randomUUID?crypto.randomUUID():String(Math.random())).slice(0,32);sessionStorage.setItem(k,s)}navigator.sendBeacon("/att/api/track",JSON.stringify({sid:s,events:[{event:"pageview",t:Date.now(),path:location.pathname}]}))}catch(e){}</script>'
INDEX="$(mktemp)"
trap 'rm -f "$INDEX"' EXIT
grep -q '</head>' "$ROOT/kayak/index.html" || { echo "kayak/index.html has no </head> to put the beacon before" >&2; exit 1; }
BEACON="$BEACON" perl -pe 's{</head>}{$ENV{BEACON}</head>}' "$ROOT/kayak/index.html" > "$INDEX"
aws s3 cp "$INDEX" "s3://$BUCKET/games/kayak/index.html" \
  --content-type "text/html; charset=utf-8" --cache-control "$CACHE" --profile "$PROFILE"
aws s3 sync "$ROOT/shared/" "s3://$BUCKET/games/shared/" --delete \
  --exclude ".*" --cache-control "$CACHE" --profile "$PROFILE"

DIST_ID="$(aws cloudfront list-distributions --profile "$PROFILE" \
  --query "DistributionList.Items[?Aliases.Items && contains(Aliases.Items, 'paddlesnitch.com')].Id | [0]" \
  --output text)"
aws cloudfront create-invalidation --distribution-id "$DIST_ID" \
  --paths "/games/kayak/*" "/games/shared/*" --profile "$PROFILE" >/dev/null

echo "Published: https://paddlesnitch.com/games/kayak/"

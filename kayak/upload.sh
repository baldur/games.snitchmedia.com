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
  --exclude "upload.sh" --exclude ".*" --cache-control "$CACHE" --profile "$PROFILE"
aws s3 sync "$ROOT/shared/" "s3://$BUCKET/games/shared/" --delete \
  --exclude ".*" --cache-control "$CACHE" --profile "$PROFILE"

DIST_ID="$(aws cloudfront list-distributions --profile "$PROFILE" \
  --query "DistributionList.Items[?Aliases.Items && contains(Aliases.Items, 'paddlesnitch.com')].Id | [0]" \
  --output text)"
aws cloudfront create-invalidation --distribution-id "$DIST_ID" \
  --paths "/games/kayak/*" "/games/shared/*" --profile "$PROFILE" >/dev/null

echo "Published: https://paddlesnitch.com/games/kayak/"

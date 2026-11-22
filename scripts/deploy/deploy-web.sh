#!/usr/bin/env bash
# Build the web app, upload it to the S3 web bucket and invalidate CloudFront.
# Usage: scripts/deploy/deploy-web.sh
# Needs: AWS credentials, AWS_REGION, the Vlp-App stack deployed.
set -euo pipefail

REGION="${AWS_REGION:?set AWS_REGION}"
STACK="Vlp-App"

output() {
  aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

BUCKET="$(output WebBucketName)"
DISTRIBUTION_ID="$(output DistributionId)"
APP_URL="$(output AppUrl)"

pnpm turbo run build --filter=@vlp/web

# 1) Fingerprinted assets: cache for a year.
aws s3 sync apps/web/dist "s3://${BUCKET}" --region "$REGION" --delete \
  --exclude index.html \
  --cache-control "public,max-age=31536000,immutable"

# 2) index.html last, never cached, so users only see the new HTML once its assets exist.
aws s3 cp apps/web/dist/index.html "s3://${BUCKET}/index.html" --region "$REGION" \
  --cache-control "no-cache" --content-type "text/html; charset=utf-8"

aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" \
  --paths "/index.html" "/" --query "Invalidation.Id" --output text

echo "Deployed web to ${APP_URL}"

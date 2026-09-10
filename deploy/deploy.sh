#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <stack-name> [site-directory]"
  exit 1
fi

STACK_NAME="$1"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR/.."
TEMPLATE_FILE="$SCRIPT_DIR/deploy.yml"
SITE_DIR="${2:-$PROJECT_ROOT/src}"
DOMAIN_NAME="${DOMAIN_NAME:-}"
HOSTED_ZONE_ID="${HOSTED_ZONE_ID:-}"

if { [ -n "$DOMAIN_NAME" ] && [ -z "$HOSTED_ZONE_ID" ]; } || \
  { [ -z "$DOMAIN_NAME" ] && [ -n "$HOSTED_ZONE_ID" ]; }; then
  echo "DOMAIN_NAME and HOSTED_ZONE_ID must either both be set or both be empty"
  exit 1
fi

PARAMETER_OVERRIDES=()
if [ -n "$DOMAIN_NAME" ]; then
  PARAMETER_OVERRIDES=(
    --parameter-overrides
    "DomainName=$DOMAIN_NAME"
    "HostedZoneId=$HOSTED_ZONE_ID"
  )
fi

if [ ! -f "$TEMPLATE_FILE" ]; then
  echo "Template file not found: $TEMPLATE_FILE"
  exit 1
fi

if [ ! -d "$SITE_DIR" ]; then
  echo "Site directory not found: $SITE_DIR"
  exit 1
fi

echo "Building TypeScript output"
(
  cd "$PROJECT_ROOT"
  pnpm build
)

echo "Deploying stack: $STACK_NAME"
echo "Using template: $TEMPLATE_FILE"
echo "Using site directory: $SITE_DIR"

aws cloudformation deploy \
  --stack-name "$STACK_NAME" \
  --template-file "$TEMPLATE_FILE" \
  "${PARAMETER_OVERRIDES[@]}" \
  --no-fail-on-empty-changeset

BUCKET_NAME="$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='BucketName'].OutputValue" \
  --output text)"

DISTRIBUTION_ID="$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" \
  --output text)"

SITE_URL="$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='SiteUrl'].OutputValue" \
  --output text)"

if [ -z "$BUCKET_NAME" ] || [ "$BUCKET_NAME" = "None" ]; then
  echo "Failed to resolve BucketName from stack outputs"
  exit 1
fi

if [ -z "$DISTRIBUTION_ID" ] || [ "$DISTRIBUTION_ID" = "None" ]; then
  echo "Failed to resolve DistributionId from stack outputs"
  exit 1
fi

echo "Syncing site to s3://$BUCKET_NAME"
aws s3 sync "$SITE_DIR" "s3://$BUCKET_NAME" --delete

echo "Invalidating CloudFront cache"
aws cloudfront create-invalidation \
  --distribution-id "$DISTRIBUTION_ID" \
  --paths "/*"

echo "Deploy complete"
echo "Site URL: $SITE_URL"

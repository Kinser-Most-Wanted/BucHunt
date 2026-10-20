
#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <stack-name> [site-directory]" >&2
  exit 1
fi

STACK_NAME="$1"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMPLATE_FILE="$SCRIPT_DIR/infrastructure.yml"
SITE_DIR="${2:-$PROJECT_ROOT/src}"

# Private S3 bucket used for Lambda deployment packages.
ARTIFACT_BUCKET="${ADMIN_ARTIFACT_BUCKET:-}"
GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-}"
ADMIN_EMAILS="${ADMIN_EMAILS:-}"

if [[ -z "$ARTIFACT_BUCKET" ]]; then
  echo "Missing ADMIN_ARTIFACT_BUCKET. Configure an existing private S3 bucket in us-east-1." >&2
  exit 1
fi

if [[ ! -f "$TEMPLATE_FILE" || ! -d "$SITE_DIR" ]]; then
  echo "Template or site directory does not exist." >&2
  exit 1
fi

case "$STACK_NAME" in
  bucstop) ENVIRONMENT_NAME=production ;;
  bucstop-stage) ENVIRONMENT_NAME=staging ;;
  bucstop-pr-[0-9]*) ENVIRONMENT_NAME=preview ;;
  *)
    echo "Unexpected stack name: $STACK_NAME" >&2
    exit 1
    ;;
esac

# Temporary PR origins are not registered with Google OAuth.
if [[ "$ENVIRONMENT_NAME" == preview ]]; then
  GOOGLE_CLIENT_ID=""
  ADMIN_EMAILS=""
fi

if [[ -n "${DOMAIN_NAME:-}" || -n "${HOSTED_ZONE_ID:-}" ]]; then
  echo "DOMAIN_NAME/HOSTED_ZONE_ID have no matching template parameters." >&2
  exit 1
fi

BUILD_DIR="$(mktemp -d)"
trap 'rm -rf "$BUILD_DIR"' EXIT

BACKEND_DIR="$BUILD_DIR/backend"
ZIP_FILE="$BUILD_DIR/admin.zip"

mkdir -p "$BACKEND_DIR"

cd "$PROJECT_ROOT"

echo "Building frontend and authentication backend"
pnpm build
pnpm build:admin "$BACKEND_DIR"

printf '%s\n' '{"name":"buchunt-admin-runtime","version":"1.0.0","private":true,"type":"commonjs"}' > "$BACKEND_DIR/package.json"

npm install --omit=dev --prefix "$BACKEND_DIR" \
  '@aws-sdk/client-dynamodb@3.1152.0' \
  'google-auth-library@10.9.1'

if [[ ! -f "$BACKEND_DIR/admin.js" ]]; then
  echo "Missing compiled admin.js" >&2
  exit 1
fi

(
  cd "$BACKEND_DIR"
  zip -qr "$ZIP_FILE" admin.js package.json node_modules
)

RELEASE_KEY="admin/${STACK_NAME}/${GITHUB_SHA:-local}-${GITHUB_RUN_ID:-manual}-${GITHUB_RUN_ATTEMPT:-1}.zip"

echo "Uploading Lambda bundle to S3"
aws s3 cp "$ZIP_FILE" "s3://${ARTIFACT_BUCKET}/${RELEASE_KEY}"

echo "Deploying CloudFormation stack: $STACK_NAME ($ENVIRONMENT_NAME)"

aws cloudformation deploy \
  --stack-name "$STACK_NAME" \
  --template-file "$TEMPLATE_FILE" \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    "EnvironmentName=$ENVIRONMENT_NAME" \
    "AdminCodeBucket=$ARTIFACT_BUCKET" \
    "AdminCodeKey=$RELEASE_KEY" \
    "GoogleClientId=$GOOGLE_CLIENT_ID" \
    "AdminEmails=$ADMIN_EMAILS" \
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

if [[ -z "$BUCKET_NAME" || "$BUCKET_NAME" == "None" ]]; then
  echo "No website bucket output" >&2
  exit 1
fi

if [[ -z "$DISTRIBUTION_ID" || "$DISTRIBUTION_ID" == "None" ]]; then
  echo "No distribution ID output" >&2
  exit 1
fi

echo "Publishing frontend"
aws s3 sync "$SITE_DIR" "s3://${BUCKET_NAME}" --delete

echo "Invalidating CloudFront cache"
aws cloudfront create-invalidation \
  --distribution-id "$DISTRIBUTION_ID" \
  --paths '/*'

echo "Deploy complete"
echo "Site URL: $SITE_URL"

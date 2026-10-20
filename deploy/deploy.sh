#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then echo "Usage: $0 <stack-name>"; exit 1; fi
STACK_NAME="$1"
ARTIFACT_BUCKET="${ADMIN_ARTIFACT_BUCKET:-}"
GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-}"
ADMIN_EMAILS="${ADMIN_EMAILS:-}"
if [[ -z "$ARTIFACT_BUCKET" ]]; then
  echo "Missing ADMIN_ARTIFACT_BUCKET. Configure a private S3 bucket in us-east-1 for the authentication Lambda." >&2
  exit 1
fi
case "$STACK_NAME" in
  bucstop-pr-[0-9]*) GOOGLE_CLIENT_ID=""; ADMIN_EMAILS="" ;;
esac
if [[ ! "$STACK_NAME" =~ ^[A-Za-z][A-Za-z0-9-]*$ ]]; then echo "Invalid stack name"; exit 1; fi
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR/.."
export AWS_DEFAULT_REGION="${AWS_REGION:-us-east-1}"

# Default VPC public subnet, or explicit existing deployment network.
VPC_ID="${VPC_ID:-$(aws ec2 describe-vpcs --filters Name=is-default,Values=true --query 'Vpcs[0].VpcId' --output text)}"
SUBNET_ID="${SUBNET_ID:-$(aws ec2 describe-subnets --filters "Name=vpc-id,Values=$VPC_ID" Name=map-public-ip-on-launch,Values=true --query 'Subnets[0].SubnetId' --output text)}"
PREFIX_ID="$(aws ec2 describe-managed-prefix-lists --filters Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing --query 'PrefixLists[0].PrefixListId' --output text)"
for value in "$VPC_ID" "$SUBNET_ID" "$PREFIX_ID"; do
  if [[ -z "$value" || "$value" == None ]]; then echo "A public subnet/VPC and CloudFront origin prefix list are required"; exit 1; fi
done
ADMIN_BUILD="$(mktemp -d)"
ADMIN_ZIP="$ADMIN_BUILD/admin.zip"
ARCHIVE=""
PARAMETERS=""
trap 'rm -f "${ARCHIVE:-}" "${PARAMETERS:-}"; rm -rf "$ADMIN_BUILD"' EXIT
(cd "$PROJECT_ROOT" && pnpm build && pnpm build:admin "$ADMIN_BUILD")
printf '%s\n' '{"name":"buchunt-admin-runtime","version":"1.0.0","private":true,"type":"commonjs"}' > "$ADMIN_BUILD/package.json"
npm install --omit=dev --prefix "$ADMIN_BUILD" '@aws-sdk/client-dynamodb@3.1152.0' 'google-auth-library@10.9.1'
(cd "$ADMIN_BUILD" && zip -qr "$ADMIN_ZIP" admin.js package.json node_modules)
ADMIN_CODE_KEY="admin/${STACK_NAME}/${GITHUB_SHA:-local}-${GITHUB_RUN_ID:-manual}-${GITHUB_RUN_ATTEMPT:-1}.zip"
aws s3 cp "$ADMIN_ZIP" "s3://$ARTIFACT_BUCKET/$ADMIN_CODE_KEY" --only-show-errors
aws cloudformation deploy --stack-name "$STACK_NAME" --template-file "$SCRIPT_DIR/infrastructure.yml" --capabilities CAPABILITY_IAM --parameter-overrides "VpcId=$VPC_ID" "SubnetId=$SUBNET_ID" "CloudFrontPrefixListId=$PREFIX_ID" "AdminCodeBucket=$ARTIFACT_BUCKET" "AdminCodeKey=$ADMIN_CODE_KEY" "GoogleClientId=$GOOGLE_CLIENT_ID" "AdminEmails=$ADMIN_EMAILS" --no-fail-on-empty-changeset
output() { aws cloudformation describe-stacks --stack-name "$STACK_NAME" --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
BUCKET="$(output BucketName)"
INSTANCE="$(output InstanceId)"
SECRET="$(output OriginSecretArn)"
SITE_URL="$(output SiteUrl)"
# Bind Google login POSTs to the deployed HTTPS site. A separate parameter avoids
# a CloudFormation dependency cycle between the function and its distribution.
aws cloudformation deploy --stack-name "$STACK_NAME" --template-file "$SCRIPT_DIR/infrastructure.yml" --capabilities CAPABILITY_IAM --parameter-overrides "VpcId=$VPC_ID" "SubnetId=$SUBNET_ID" "CloudFrontPrefixListId=$PREFIX_ID" "AdminCodeBucket=$ARTIFACT_BUCKET" "AdminCodeKey=$ADMIN_CODE_KEY" "GoogleClientId=$GOOGLE_CLIENT_ID" "AdminEmails=$ADMIN_EMAILS" "AdminOrigin=$SITE_URL" --no-fail-on-empty-changeset
DISTRIBUTION="$(output DistributionId)"
RELEASE="$(date -u +%Y%m%d%H%M%S)-$(git -C "$PROJECT_ROOT" rev-parse --short HEAD)"
ARCHIVE="$(mktemp)"
PARAMETERS="$(mktemp)"
# Neither source configuration nor runtime data is uploaded to the public app.
tar -czf "$ARCHIVE" -C "$PROJECT_ROOT" package.json -C src index.html admin.html player.html css js
aws s3 cp "$ARCHIVE" "s3://$BUCKET/releases/$RELEASE.tar.gz" --only-show-errors
# Wait for SSM registration and cloud-init; never start against a partial release.
for attempt in $(seq 1 60); do
  STATUS="$(aws ssm describe-instance-information --filters "Key=InstanceIds,Values=$INSTANCE" --query 'InstanceInformationList[0].PingStatus' --output text)"
  if [[ "$STATUS" == Online ]]; then break; fi
  if [[ "$attempt" == 60 ]]; then echo "Instance did not register with SSM"; exit 1; fi
  sleep 5
done
export BUCKET INSTANCE SECRET RELEASE
python3 - "$PARAMETERS" <<'PY'
import json, os, sys
bucket, secret, release = (os.environ[k] for k in ('BUCKET','SECRET','RELEASE'))
region = os.environ['AWS_DEFAULT_REGION']
script = f'''set -eu
export AWS_DEFAULT_REGION={region}
cloud-init status --wait
install -d -m 755 /opt/buchunt/releases/{release}
aws s3 cp s3://{bucket}/releases/{release}.tar.gz /tmp/buchunt-release.tar.gz --only-show-errors
tar -xzf /tmp/buchunt-release.tar.gz -C /opt/buchunt/releases/{release}
# Archive contains frontend files at its root; serve them under src/.
cd /opt/buchunt/releases/{release}
mkdir src
mv index.html admin.html player.html css js src/
TOKEN=$(aws secretsmanager get-secret-value --secret-id {secret} --query SecretString --output text)
umask 077
printf 'HOST=0.0.0.0\\nPORT=3000\\nDATA_DIRECTORY=/var/lib/buchunt\\nORIGIN_TOKEN=%s\\n' "$TOKEN" > /etc/buchunt.env
ln -sfn /opt/buchunt/releases/{release} /opt/buchunt/next
mv -Tf /opt/buchunt/next /opt/buchunt/current
systemctl restart buchunt
systemctl is-active --quiet buchunt
'''
json.dump({'commands':[script], 'executionTimeout':['600']}, open(sys.argv[1],'w'))
PY
COMMAND="$(aws ssm send-command --instance-ids "$INSTANCE" --document-name AWS-RunShellScript --parameters "file://$PARAMETERS" --query Command.CommandId --output text)"
for attempt in $(seq 1 120); do
  STATUS="$(aws ssm get-command-invocation --command-id "$COMMAND" --instance-id "$INSTANCE" --query Status --output text 2>/dev/null || true)"
  case "$STATUS" in
    Success) break ;;
    Failed|Cancelled|TimedOut|Cancelling) echo "Deployment command failed: $COMMAND ($STATUS). Inspect SSM output."; exit 1 ;;
  esac
  if [[ "$attempt" == 120 ]]; then echo "Deployment command timed out: $COMMAND"; exit 1; fi
  sleep 5
done
# Flush objects cached by the previous static-only distribution configuration.
INVALIDATION="$(aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION" --paths '/*' --query Invalidation.Id --output text)"
aws cloudfront wait invalidation-completed --distribution-id "$DISTRIBUTION" --id "$INVALIDATION"
curl --fail --retry 12 --retry-all-errors --retry-delay 5 "$SITE_URL/api/health"
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  printf 'site_url=%s\n' "$SITE_URL" >> "$GITHUB_OUTPUT"
fi
printf '\nSite URL: %s\n' "$SITE_URL"

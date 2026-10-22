#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then echo "Usage: $0 <stack-name>"; exit 1; fi
STACK_NAME="$1"
DELETE_ROOT_VOLUME=false
if [[ "$STACK_NAME" =~ ^bucstop-pr-[0-9]+$ ]]; then
  DELETE_ROOT_VOLUME=true
fi
ARTIFACT_BUCKET="${ADMIN_ARTIFACT_BUCKET:-}"
GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-}"
ADMIN_EMAILS="${ADMIN_EMAILS:-}"
RESTORE_PARAMETERS_JSON="${RESTORE_PARAMETERS_JSON:-}"
if [[ -z "$ARTIFACT_BUCKET" ]]; then
  echo "Missing ADMIN_ARTIFACT_BUCKET. Configure a private S3 bucket in us-east-1 for the authentication Lambda." >&2
  exit 1
fi
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
if [[ -z "$GOOGLE_CLIENT_ID" ]]; then
  echo "Missing GOOGLE_CLIENT_ID. Configure the GitHub Actions variable before deployment." >&2
  exit 1
fi
STACK_EXISTS=false
EXISTING_ORIGIN=https://localhost
if EXISTING_STACK=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --output json 2>&1); then
  STACK_EXISTS=true
  EXISTING_ORIGIN=$(echo "$EXISTING_STACK" | jq -r '[.Stacks[0].Parameters[]? | select(.ParameterKey == "AdminOrigin")][0].ParameterValue // "https://localhost"')
  if [[ -n "${GITHUB_OUTPUT:-}" && -z "$RESTORE_PARAMETERS_JSON" ]]; then
    printf 'previous_parameters=%s\n' "$(echo "$EXISTING_STACK" | jq -c '.Stacks[0].Parameters | map({ParameterKey, ParameterValue})')" >> "$GITHUB_OUTPUT"
  fi
  EXISTING_INSTANCE=$(aws cloudformation list-stack-resources --stack-name "$STACK_NAME" --query "StackResourceSummaries[?LogicalResourceId=='ApplicationInstance' && ResourceStatus!='DELETE_COMPLETE'].PhysicalResourceId | [0]" --output text)
  if [[ -n "$EXISTING_INSTANCE" && "$EXISTING_INSTANCE" != None ]]; then
    IMAGE_ID=$(aws ec2 describe-instances --instance-ids "$EXISTING_INSTANCE" --query 'Reservations[0].Instances[0].ImageId' --output text)
  elif [[ "$DELETE_ROOT_VOLUME" == false ]]; then
    echo "Existing persistent stack has no recoverable instance. Restore its data before redeploying." >&2
    exit 1
  fi
elif [[ "$EXISTING_STACK" != *ValidationError* || "$EXISTING_STACK" != *"Stack with id $STACK_NAME does not exist"* ]]; then
  echo "$EXISTING_STACK" >&2
  exit 1
fi
IMAGE_ID="${IMAGE_ID:-$(aws ssm get-parameter --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 --query Parameter.Value --output text)}"
if [[ ! "$IMAGE_ID" =~ ^ami-[a-f0-9]+$ ]]; then echo "Could not resolve a valid AMI" >&2; exit 1; fi
# Inspect the actual change set before applying it. Root data cannot silently be
# abandoned by an instance replacement, removal, or conditional replacement.
deploy_stack() {
  local change_type=UPDATE change_set parameters changes status reason replacement
  [[ "$STACK_EXISTS" == true ]] || change_type=CREATE
  change_set="buchunt-$(date -u +%Y%m%d%H%M%S)-$RANDOM"
  parameters=$(IMAGE_ID="$IMAGE_ID" RESTORE_PARAMETERS_JSON="$RESTORE_PARAMETERS_JSON" python3 - "$@" <<'PARAMETERS'
import json, os, sys
if os.environ['RESTORE_PARAMETERS_JSON']:
    parameters = json.loads(os.environ['RESTORE_PARAMETERS_JSON'])
    if not isinstance(parameters, list) or not all(isinstance(p, dict) and isinstance(p.get('ParameterKey'), str) and isinstance(p.get('ParameterValue'), str) for p in parameters):
        raise SystemExit('Invalid authentication rollback parameters')
    # Old stacks used an SSM parameter path; the new template takes an AMI ID.
    parameters = [p for p in parameters if p['ParameterKey'] != 'ImageId']
    parameters.append({'ParameterKey': 'ImageId', 'ParameterValue': os.environ['IMAGE_ID']})
else:
    parameters = [dict(zip(('ParameterKey', 'ParameterValue'), arg.split('=', 1))) for arg in sys.argv[1:]]
print(json.dumps(parameters))
PARAMETERS
)
  aws cloudformation create-change-set --stack-name "$STACK_NAME" --change-set-name "$change_set" --change-set-type "$change_type" --template-body "file://$SCRIPT_DIR/infrastructure.yml" --capabilities CAPABILITY_IAM --parameters "$parameters" >/dev/null
  if ! aws cloudformation wait change-set-create-complete --stack-name "$STACK_NAME" --change-set-name "$change_set"; then
    changes=$(aws cloudformation describe-change-set --stack-name "$STACK_NAME" --change-set-name "$change_set" --output json)
    status=$(echo "$changes" | jq -r .Status)
    reason=$(echo "$changes" | jq -r .StatusReason)
    aws cloudformation delete-change-set --stack-name "$STACK_NAME" --change-set-name "$change_set"
    if [[ "$status" == FAILED && ( "$reason" == *"didn't contain changes"* || "$reason" == *"No updates are to be performed"* ) ]]; then
      echo "No infrastructure changes."
      return 0
    fi
    echo "Change set failed: $reason" >&2
    return 1
  fi
  changes=$(aws cloudformation describe-change-set --stack-name "$STACK_NAME" --change-set-name "$change_set" --output json)
  replacement=$(echo "$changes" | jq -r 'if (.Changes | type) != "array" then error("Invalid change set") else [.Changes[] | .ResourceChange | select(.LogicalResourceId == "ApplicationInstance" and (.Action == "Remove" or (.Action == "Modify" and .Replacement != "False")))] | length > 0 end')
  if [[ "$DELETE_ROOT_VOLUME" == false && "$replacement" == true ]]; then
    aws cloudformation delete-change-set --stack-name "$STACK_NAME" --change-set-name "$change_set"
    echo "Refusing persistent instance replacement/removal. Plan and verify data recovery before a maintenance deployment." >&2
    return 1
  fi
  aws cloudformation execute-change-set --stack-name "$STACK_NAME" --change-set-name "$change_set"
  if [[ "$change_type" == CREATE ]]; then
    aws cloudformation wait stack-create-complete --stack-name "$STACK_NAME"
  else
    aws cloudformation wait stack-update-complete --stack-name "$STACK_NAME"
  fi
  STACK_EXISTS=true
}
if [[ -n "$RESTORE_PARAMETERS_JSON" ]]; then
  if [[ "$STACK_EXISTS" != true ]]; then echo "Cannot restore a missing stack" >&2; exit 1; fi
  deploy_stack
  echo "Restored the previous authentication artifact and configuration."
  exit 0
fi
ADMIN_BUILD="$(mktemp -d)"
ADMIN_ZIP="$ADMIN_BUILD/admin.zip"
ARCHIVE=""
PARAMETERS=""
trap 'rm -f "${ARCHIVE:-}" "${PARAMETERS:-}"; rm -rf "$ADMIN_BUILD"' EXIT
(cd "$PROJECT_ROOT" && pnpm build && pnpm build:admin "$ADMIN_BUILD")
cp "$PROJECT_ROOT/package.json" "$PROJECT_ROOT/pnpm-lock.yaml" "$ADMIN_BUILD/"
pnpm install --prod --frozen-lockfile --ignore-scripts --config.node-linker=hoisted --dir "$ADMIN_BUILD"
# The Lambda entry point is CommonJS; the EC2 application keeps its ESM manifest.
python3 - "$ADMIN_BUILD/package.json" <<'MANIFEST'
import json, sys
path = sys.argv[1]
with open(path) as file:
    manifest = json.load(file)
manifest['type'] = 'commonjs'
with open(path, 'w') as file:
    json.dump(manifest, file)
MANIFEST
(cd "$ADMIN_BUILD" && zip -qr "$ADMIN_ZIP" admin.js package.json node_modules)
ADMIN_CODE_KEY="admin/${STACK_NAME}/${GITHUB_SHA:-local}-${GITHUB_RUN_ID:-manual}-${GITHUB_RUN_ATTEMPT:-1}.zip"
aws s3 cp "$ADMIN_ZIP" "s3://$ARTIFACT_BUCKET/$ADMIN_CODE_KEY" --only-show-errors
deploy_stack "ImageId=$IMAGE_ID" "VpcId=$VPC_ID" "SubnetId=$SUBNET_ID" "CloudFrontPrefixListId=$PREFIX_ID" "AdminCodeBucket=$ARTIFACT_BUCKET" "AdminCodeKey=$ADMIN_CODE_KEY" "GoogleClientId=$GOOGLE_CLIENT_ID" "AdminEmails=$ADMIN_EMAILS" "DeleteRootVolumeOnTermination=$DELETE_ROOT_VOLUME" "AdminOrigin=$EXISTING_ORIGIN"
output() { aws cloudformation describe-stacks --stack-name "$STACK_NAME" --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text; }
BUCKET="$(output BucketName)"
INSTANCE="$(output InstanceId)"
SECRET="$(output OriginSecretArn)"
SITE_URL="$(output SiteUrl)"
# Bind Google login POSTs to the deployed HTTPS site. A separate parameter avoids
# a CloudFormation dependency cycle between the function and its distribution.
deploy_stack "ImageId=$IMAGE_ID" "VpcId=$VPC_ID" "SubnetId=$SUBNET_ID" "CloudFrontPrefixListId=$PREFIX_ID" "AdminCodeBucket=$ARTIFACT_BUCKET" "AdminCodeKey=$ADMIN_CODE_KEY" "GoogleClientId=$GOOGLE_CLIENT_ID" "AdminEmails=$ADMIN_EMAILS" "DeleteRootVolumeOnTermination=$DELETE_ROOT_VOLUME" "AdminOrigin=$SITE_URL"
DISTRIBUTION="$(output DistributionId)"
RELEASE="$(date -u +%Y%m%d%H%M%S)-$(git -C "$PROJECT_ROOT" rev-parse --short HEAD)-${GITHUB_RUN_ID:-manual}-${GITHUB_RUN_ATTEMPT:-1}"
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  printf 'instance_id=%s\nrelease=%s\nauth_session_table=%s\n' "$INSTANCE" "$RELEASE" "$(output AuthSessionTable)" >> "$GITHUB_OUTPUT"
fi
ARCHIVE="$(mktemp)"
PARAMETERS="$(mktemp)"
# Neither source configuration nor runtime data is uploaded to the public app.
tar -czf "$ARCHIVE" -C "$PROJECT_ROOT" package.json -C "$ADMIN_BUILD" node_modules -C "$PROJECT_ROOT/src" index.html admin.html player.html css js assets
aws s3 cp "$ARCHIVE" "s3://$BUCKET/releases/$RELEASE.tar.gz" --only-show-errors
# Wait for SSM registration and cloud-init; never start against a partial release.
for attempt in $(seq 1 60); do
  STATUS="$(aws ssm describe-instance-information --filters "Key=InstanceIds,Values=$INSTANCE" --query 'InstanceInformationList[0].PingStatus' --output text)"
  if [[ "$STATUS" == Online ]]; then break; fi
  if [[ "$attempt" == 60 ]]; then echo "Instance did not register with SSM"; exit 1; fi
  sleep 5
done
export BUCKET INSTANCE SECRET RELEASE GOOGLE_CLIENT_ID
python3 - "$PARAMETERS" <<'PY'
import json, os, sys
bucket, secret, release = (os.environ[k] for k in ('BUCKET','SECRET','RELEASE'))
region = os.environ['AWS_DEFAULT_REGION']
google_client_id = os.environ['GOOGLE_CLIENT_ID']
import re
if not re.fullmatch(r'[A-Za-z0-9._-]*', google_client_id):
    raise SystemExit('Invalid GOOGLE_CLIENT_ID')
script = f'''set -Eeuo pipefail
export AWS_DEFAULT_REGION={region}
cloud-init status --wait
install -d -m 755 /opt/buchunt/releases/{release}
aws s3 cp s3://{bucket}/releases/{release}.tar.gz /tmp/buchunt-release.tar.gz --only-show-errors
tar -xzf /tmp/buchunt-release.tar.gz -C /opt/buchunt/releases/{release}
# Archive contains frontend files at its root; serve them under src/.
cd /opt/buchunt/releases/{release}
mkdir src
mv index.html admin.html player.html css js assets src/
PREVIOUS=$(readlink -f /opt/buchunt/current || true)
printf '%s\\n' "$PREVIOUS" > /opt/buchunt/releases/{release}/previous
if [[ -f /etc/buchunt.env ]]; then
  cp -p /etc/buchunt.env /opt/buchunt/releases/{release}/previous.env
fi
cat > /opt/buchunt/releases/{release}/rollback.sh <<'ROLLBACK'
#!/usr/bin/env bash
set -euo pipefail
DIRECTORY=/opt/buchunt/releases/{release}
[[ ! -f "$DIRECTORY/rolled-back" ]] || exit 0
previous=$(cat "$DIRECTORY/previous")
if [[ -n "$previous" && -d "$previous" ]]; then
  if [[ -f "$DIRECTORY/previous.env" ]]; then cp -p "$DIRECTORY/previous.env" /etc/buchunt.env; fi
  ln -sfn "$previous" /opt/buchunt/next
  mv -Tf /opt/buchunt/next /opt/buchunt/current
  systemctl restart buchunt
  systemctl is-active --quiet buchunt
else
  systemctl stop buchunt
fi
touch "$DIRECTORY/rolled-back"
ROLLBACK
chmod 700 /opt/buchunt/releases/{release}/rollback.sh
trap 'bash /opt/buchunt/releases/{release}/rollback.sh' ERR
TOKEN=$(aws secretsmanager get-secret-value --secret-id {secret} --query SecretString --output text)
umask 077
printf 'HOST=0.0.0.0\\nPORT=3000\\nDATA_DIRECTORY=/var/lib/buchunt\\nORIGIN_TOKEN=%s\\nGOOGLE_CLIENT_ID={google_client_id}\\n' "$TOKEN" > /etc/buchunt.env
ln -sfn /opt/buchunt/releases/{release} /opt/buchunt/next
mv -Tf /opt/buchunt/next /opt/buchunt/current
systemctl restart buchunt
curl --fail --silent --show-error --retry 12 --retry-all-errors --retry-delay 2 -H "X-Origin-Token: $TOKEN" http://127.0.0.1:3000/api/health
systemctl is-active --quiet buchunt
trap - ERR
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

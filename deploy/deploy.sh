#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then echo "Usage: $0 <stack-name> [preview-pr-number] | reset-preview <stack-name> <preview-pr-number>"; exit 1; fi
if [[ "$1" == allocate-preview-slots ]]; then
  if [[ -z "${GH_TOKEN:-}" || -z "${GITHUB_REPOSITORY:-}" ]]; then
    echo "GH_TOKEN and GITHUB_REPOSITORY are required to allocate preview slots." >&2
    exit 1
  fi
  export GH_TOKEN
  for SLOT_LABEL in preview-slot-1 preview-slot-2 preview-slot-3; do
    COLOR=0969DA
    case "$SLOT_LABEL" in
      preview-slot-1) COLOR=1F6FEB ;;
      preview-slot-2) COLOR=8250DF ;;
      preview-slot-3) COLOR=BF3989 ;;
    esac
    gh api --method POST "repos/$GITHUB_REPOSITORY/labels" -f "name=$SLOT_LABEL" -f "color=$COLOR" -f "description=Automatically assigned stable preview deployment slot" >/dev/null 2>&1 || true
  done
  gh api --method POST "repos/$GITHUB_REPOSITORY/labels" -f "name=Queued" -f "color=FBCA04" -f "description=Waiting for an available preview deployment slot" >/dev/null 2>&1 || true
  queue_pr() {
    gh api --method POST "repos/$GITHUB_REPOSITORY/issues/$1/labels" -f "labels[]=Queued" >/dev/null
  }
  unqueue_pr() {
    gh api --method DELETE "repos/$GITHUB_REPOSITORY/issues/$1/labels/Queued" >/dev/null 2>&1 || true
  }
  is_stage_pr() {
    echo "$1" | jq -e '(.title == "Stage") or (.base_ref == "main" and .head_ref == "stage")' >/dev/null
  }

  OPEN_PRS=$(gh api --paginate --jq '.[] | {number, state, title: .title, base_ref: .base.ref, head_ref: .head.ref, labels: [.labels[].name]}' "repos/$GITHUB_REPOSITORY/pulls?state=all&sort=created&direction=asc&per_page=100")
  USED_1=false
  USED_2=false
  USED_3=false
  while IFS= read -r PR_JSON; do
    [[ -n "$PR_JSON" ]] || continue
    [[ "$(echo "$PR_JSON" | jq -r .state)" == open ]] || continue
    is_stage_pr "$PR_JSON" && continue
    for SLOT in 1 2 3; do
      if echo "$PR_JSON" | jq -e --arg label "preview-slot-$SLOT" '.labels | index($label) != null' >/dev/null; then
        case "$SLOT" in
          1) USED_1=true ;;
          2) USED_2=true ;;
          3) USED_3=true ;;
        esac
      fi
    done
  done <<< "$OPEN_PRS"

  ASSIGNED_PRS=()
  while IFS= read -r PR_JSON; do
    [[ -n "$PR_JSON" ]] || continue
    [[ "$(echo "$PR_JSON" | jq -r .state)" == open ]] || continue
    TARGET_PR=$(echo "$PR_JSON" | jq -r .number)
    if is_stage_pr "$PR_JSON"; then
      STALE_SLOT_LABELS=$(echo "$PR_JSON" | jq -r '.labels[] | select(test("^preview-slot-[123]$"))')
      while IFS= read -r SLOT_LABEL; do
        [[ -n "$SLOT_LABEL" ]] || continue
        gh api --method DELETE "repos/$GITHUB_REPOSITORY/issues/$TARGET_PR/labels/$SLOT_LABEL" >/dev/null 2>&1 || true
      done <<< "$STALE_SLOT_LABELS"
      unqueue_pr "$TARGET_PR"
      echo "PR #$TARGET_PR is the Stage PR; skipping preview allocation."
      continue
    fi
    SLOT_COUNT=$(echo "$PR_JSON" | jq '[.labels[] | select(test("^preview-slot-[123]$"))] | length')
    if [[ "$SLOT_COUNT" -ne 0 ]]; then
      unqueue_pr "$TARGET_PR"
      if [[ "$SLOT_COUNT" -gt 1 ]]; then
        echo "PR #$TARGET_PR has multiple preview slot labels; leaving it unchanged." >&2
      fi
      continue
    fi
    if [[ "$TARGET_PR" != "${CURRENT_PR_NUMBER:-}" ]]; then
      TARGET_HEAD=$(gh api "repos/$GITHUB_REPOSITORY/pulls/$TARGET_PR" --jq .head.sha)
      WORKFLOW_RUNS=$(gh api --paginate "repos/$GITHUB_REPOSITORY/actions/workflows/deploy.yml/runs?event=pull_request&status=completed&per_page=100")
      SUCCESSFUL_RUN=$(echo "$WORKFLOW_RUNS" | jq -r --arg sha "$TARGET_HEAD" --arg pr "$TARGET_PR" '.workflow_runs[] | select(.conclusion == "success" and any(.pull_requests[]?; (.number | tostring) == $pr and .head.sha == $sha)) | .id' | head -n 1)
      if [[ -z "$SUCCESSFUL_RUN" ]]; then
        queue_pr "$TARGET_PR"
        echo "PR #$TARGET_PR is waiting for its current checks to pass before receiving a preview slot."
        continue
      fi
    fi
    SLOT=""
    if [[ "$USED_1" != true ]]; then SLOT=1; USED_1=true
    elif [[ "$USED_2" != true ]]; then SLOT=2; USED_2=true
    elif [[ "$USED_3" != true ]]; then SLOT=3; USED_3=true
    else
      queue_pr "$TARGET_PR"
      echo "Preview slots are full; PR #$TARGET_PR remains queued."
      continue
    fi
    PR_NUMBER_TO_ASSIGN=$(echo "$PR_JSON" | jq -r .number)
    SLOT_LABEL="preview-slot-$SLOT"
    gh api --method POST "repos/$GITHUB_REPOSITORY/issues/$PR_NUMBER_TO_ASSIGN/labels" -f "labels[]=$SLOT_LABEL" >/dev/null
    unqueue_pr "$PR_NUMBER_TO_ASSIGN"
    echo "Assigned $SLOT_LABEL to PR #$PR_NUMBER_TO_ASSIGN."
    ASSIGNED_PRS+=("$PR_NUMBER_TO_ASSIGN")
  done <<< "$OPEN_PRS"
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    ASSIGNED_LIST=$(IFS=,; echo "${ASSIGNED_PRS[*]}")
    printf 'assigned_prs=%s\n' "$ASSIGNED_LIST" >> "$GITHUB_OUTPUT"
  fi
  exit 0
fi
if [[ "$1" == reset-preview ]]; then
  if [[ "$#" -ne 3 || ! "$3" =~ ^[0-9]+$ || ! "$2" =~ ^bucstop-preview-[123]$ ]]; then
    echo "Usage: $0 reset-preview <bucstop-preview-1|2|3> <preview-pr-number>" >&2
    exit 1
  fi
  RESET_STACK="$2"
  RESET_PR="$3"
  RESET_INSTANCE=$(aws cloudformation describe-stacks --stack-name "$RESET_STACK" --query "Stacks[0].Outputs[?OutputKey=='InstanceId'].OutputValue" --output text)
  if [[ -z "$RESET_INSTANCE" || "$RESET_INSTANCE" == None ]]; then echo "Preview stack has no instance" >&2; exit 1; fi
  RESET_PARAMETERS=$(python3 - "$RESET_PR" <<'PY'
import json, sys
pr = sys.argv[1]
script = f"""set -euo pipefail
DATA=/var/lib/buchunt
OWNER="$DATA/.preview-pr-owner"
if [[ -f "$OWNER" && "$(cat "$OWNER")" == "{pr}" ]]; then
  systemctl stop buchunt || true
  find "$DATA" -mindepth 1 -maxdepth 1 -exec rm -rf -- {{}} +
  systemctl start buchunt
  echo "Cleared preview data for closed PR #{pr}."
else
  echo "Preview is not owned by PR #{pr}; no data was removed."
fi
"""
print(json.dumps({"commands": [script]}))
PY
)
  RESET_COMMAND=$(aws ssm send-command --instance-ids "$RESET_INSTANCE" --document-name AWS-RunShellScript --parameters "$RESET_PARAMETERS" --query Command.CommandId --output text)
  aws ssm wait command-executed --command-id "$RESET_COMMAND" --instance-id "$RESET_INSTANCE"
  aws ssm get-command-invocation --command-id "$RESET_COMMAND" --instance-id "$RESET_INSTANCE" --query StandardOutputContent --output text
  exit 0
fi
STACK_NAME="$1"
PREVIEW_PR_NUMBER="${PREVIEW_PR_NUMBER:-}"
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
export BUCKET INSTANCE SECRET RELEASE GOOGLE_CLIENT_ID PREVIEW_PR_NUMBER
python3 - "$PARAMETERS" <<'PY'
import json, os, sys
bucket, secret, release = (os.environ[k] for k in ('BUCKET','SECRET','RELEASE'))
region = os.environ['AWS_DEFAULT_REGION']
google_client_id = os.environ['GOOGLE_CLIENT_ID']
preview_pr_number = os.environ.get('PREVIEW_PR_NUMBER', '')
if preview_pr_number and not preview_pr_number.isdigit():
    raise SystemExit('Invalid PREVIEW_PR_NUMBER')
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
# readlink -f can return the nonexistent current path on a first deployment.
# Only remember an existing, concrete release with a valid server entry point.
PREVIOUS=""
RESOLVED=$(readlink -e /opt/buchunt/current || true)
case "$RESOLVED" in
  /opt/buchunt/releases/*)
    if [[ "$RESOLVED" != /opt/buchunt/releases/{release} && -f "$RESOLVED/src/js/server/server.js" ]]; then
      PREVIOUS="$RESOLVED"
    fi
    ;;
esac
printf '%s\\n' "$PREVIOUS" > /opt/buchunt/releases/{release}/previous
if [[ -f /etc/buchunt.env ]]; then
  cp -p /etc/buchunt.env /opt/buchunt/releases/{release}/previous.env
fi
cat > /opt/buchunt/releases/{release}/rollback.sh <<'ROLLBACK'
#!/usr/bin/env bash
set -euo pipefail
DIRECTORY=/opt/buchunt/releases/{release}
[[ ! -f "$DIRECTORY/rolled-back" ]] || exit 0
diagnostics() {{
  systemctl status buchunt --no-pager --full || true
  journalctl -u buchunt -n 60 --no-pager || true
}}
previous=$(cat "$DIRECTORY/previous")
if [[ -z "$previous" ]]; then
  echo "::warning::No previous application release exists; skipping rollback and leaving the current release unchanged."
  touch "$DIRECTORY/rolled-back"
  exit 0
fi
case "$previous" in
  /opt/buchunt/releases/*) ;;
  *) echo "Invalid saved rollback target: $previous" >&2; diagnostics; exit 1 ;;
esac
resolved=$(readlink -e "$previous" || true)
case "$resolved" in
  /opt/buchunt/releases/*) ;;
  *) echo "Rollback target is missing or resolves outside the release directory." >&2; diagnostics; exit 1 ;;
esac
if [[ "$resolved" == "$DIRECTORY" || ! -f "$resolved/src/js/server/server.js" ]]; then
  echo "Rollback target is the failed release or lacks the server entry point." >&2
  diagnostics
  exit 1
fi
if [[ -f "$DIRECTORY/previous.env" ]]; then cp -p "$DIRECTORY/previous.env" /etc/buchunt.env; fi
ln -sfn "$resolved" /opt/buchunt/next
mv -Tf /opt/buchunt/next /opt/buchunt/current
systemctl reset-failed buchunt
if ! systemctl restart buchunt; then diagnostics; exit 1; fi
TOKEN=$(sed -n 's/^ORIGIN_TOKEN=//p' /etc/buchunt.env)
READY=false
for attempt in $(seq 1 30); do
  if systemctl is-active --quiet buchunt && curl --fail --silent -H "X-Origin-Token: $TOKEN" http://127.0.0.1:3000/api/health >/dev/null; then
    READY=true
    break
  fi
  sleep 2
done
if [[ "$READY" != true ]]; then
  echo "Previous application release did not become healthy." >&2
  diagnostics
  exit 1
fi
echo "Restored healthy application release: $resolved"
touch "$DIRECTORY/rolled-back"
ROLLBACK
chmod 700 /opt/buchunt/releases/{release}/rollback.sh
trap 'bash /opt/buchunt/releases/{release}/rollback.sh' ERR
TOKEN=$(aws secretsmanager get-secret-value --secret-id {secret} --query SecretString --output text)
umask 077
printf 'HOST=0.0.0.0\\nPORT=3000\\nDATA_DIRECTORY=/var/lib/buchunt\\nORIGIN_TOKEN=%s\\nGOOGLE_CLIENT_ID={google_client_id}\\n' "$TOKEN" > /etc/buchunt.env
if [[ -n "{preview_pr_number}" ]]; then
  DATA_DIR=/var/lib/buchunt
  install -d -m 700 "$DATA_DIR"
  OWNER_FILE="$DATA_DIR/.preview-pr-owner"
  CURRENT_OWNER=$(cat "$OWNER_FILE" 2>/dev/null || true)
  if [[ "$CURRENT_OWNER" != "{preview_pr_number}" ]]; then
    systemctl stop buchunt || true
    find "$DATA_DIR" -mindepth 1 -maxdepth 1 ! -name '.preview-pr-owner' -exec rm -rf -- {{}} +
    echo "Reset preview data for PR #{preview_pr_number}."
  fi
  printf '%s\\n' "{preview_pr_number}" > "$OWNER_FILE"
fi
ln -sfn /opt/buchunt/releases/{release} /opt/buchunt/next
mv -Tf /opt/buchunt/next /opt/buchunt/current
systemctl reset-failed buchunt
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
    Failed|Cancelled|TimedOut|Cancelling)
      echo "Deployment command failed: $COMMAND ($STATUS)." >&2
      aws ssm get-command-invocation --command-id "$COMMAND" --instance-id "$INSTANCE" --query '{Status:Status,ResponseCode:ResponseCode,Output:StandardOutputContent,Error:StandardErrorContent}' --output json >&2 || true
      exit 1 ;;
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

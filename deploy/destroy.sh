#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <stack-name>"
  exit 1
fi

STACK_NAME="$1"
AWS_REGION="${AWS_REGION:-us-east-1}"

echo "Resolving stack metadata for: $STACK_NAME"

# Only an explicit missing-stack response is a successful no-op. Preserve all
# other AWS errors (including IAM failures) in the Actions log.
if ! STACK_JSON=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" --region "$AWS_REGION" --output json 2>&1); then
  if [[ "$STACK_JSON" == *"ValidationError"* && "$STACK_JSON" == *"Stack with id $STACK_NAME does not exist"* ]]; then
    echo "Stack already absent: $STACK_NAME"
    exit 0
  fi
  echo "$STACK_JSON" >&2
  exit 1
fi
STACK_ID=$(echo "$STACK_JSON" | jq -er '.Stacks[0].StackId')
STATUS=$(echo "$STACK_JSON" | jq -er '.Stacks[0].StackStatus')
# An older deployment may still be completing its CloudFormation operation.
for attempt in $(seq 1 180); do
  if [[ "$STATUS" == DELETE_COMPLETE ]]; then
    echo "Deleted stack: $STACK_NAME"
    exit 0
  fi
  [[ "$STATUS" == DELETE_IN_PROGRESS ]] && break
  [[ "$STATUS" != *_IN_PROGRESS ]] && break
  sleep 20
  STATUS=$(aws cloudformation describe-stacks --stack-name "$STACK_ID" \
    --region "$AWS_REGION" --query 'Stacks[0].StackStatus' --output text)
done
if [[ "$STATUS" == *_IN_PROGRESS && "$STATUS" != DELETE_IN_PROGRESS ]]; then
  echo "Stack is still busy: $STATUS" >&2
  exit 1
fi
# Resource lookup also works for failed creations with no stack outputs.
if [[ "$STATUS" != DELETE_IN_PROGRESS ]]; then
  RESOURCES=$(aws cloudformation list-stack-resources --stack-name "$STACK_ID" \
    --region "$AWS_REGION" --output json)
  BUCKET_NAME=$(echo "$RESOURCES" | jq -r '.StackResourceSummaries[] | select(.LogicalResourceId == "WebsiteBucket" and .ResourceStatus != "DELETE_COMPLETE") | .PhysicalResourceId // empty')
  # Existing PR stacks predate the template's disposable-volume setting. Update
  # only their attached root mapping before terminating through CloudFormation.
  if [[ "$STACK_NAME" =~ ^bucstop-pr-[0-9]+$ ]]; then
    INSTANCE_ID=$(echo "$RESOURCES" | jq -r '.StackResourceSummaries[] | select(.LogicalResourceId == "ApplicationInstance" and .ResourceStatus != "DELETE_COMPLETE") | .PhysicalResourceId // empty')
    if [[ -n "$INSTANCE_ID" ]]; then
      if INSTANCE_JSON=$(aws ec2 describe-instances --instance-ids "$INSTANCE_ID" \
        --region "$AWS_REGION" --output json 2>&1); then
        ROOT_MAPPING=$(echo "$INSTANCE_JSON" | jq -c '[.Reservations[].Instances[] | select(.State.Name != "terminated" and .State.Name != "shutting-down") | .RootDeviceName as $root | .BlockDeviceMappings[] | select(.DeviceName == $root and .Ebs.DeleteOnTermination != true) | {DeviceName: .DeviceName, Ebs: {DeleteOnTermination: true}}]')
        if [[ "$ROOT_MAPPING" != '[]' ]] && ! aws ec2 modify-instance-attribute --instance-id "$INSTANCE_ID" \
          --region "$AWS_REGION" --block-device-mappings "$ROOT_MAPPING"; then
          echo "::warning::Could not enable root-volume deletion for $INSTANCE_ID. Continuing stack deletion; inspect retained EBS volumes afterward."
        fi
      elif [[ "$INSTANCE_JSON" == *InvalidInstanceID.NotFound* ]]; then
        echo "Instance is already absent: $INSTANCE_ID"
      else
        echo "::warning::Could not inspect $INSTANCE_ID: $INSTANCE_JSON. Continuing stack deletion; inspect retained EBS volumes afterward."
      fi
    fi
  fi

  if [ -n "${BUCKET_NAME:-}" ] && [ "$BUCKET_NAME" != "None" ]; then
    echo "Emptying versioned bucket: s3://$BUCKET_NAME"

    KEY_MARKER=""
    VERSION_ID_MARKER=""

    while true; do
      if [ -n "$KEY_MARKER" ]; then
        VERSIONS_JSON="$(aws s3api list-object-versions \
          --bucket "$BUCKET_NAME" \
          --region "$AWS_REGION" \
          --no-paginate --max-keys 1000 \
          --key-marker "$KEY_MARKER" \
          --version-id-marker "$VERSION_ID_MARKER" \
          --output json)"
      else
        VERSIONS_JSON="$(aws s3api list-object-versions \
          --bucket "$BUCKET_NAME" \
          --region "$AWS_REGION" \
          --no-paginate --max-keys 1000 \
          --output json)"
      fi

      OBJECTS_TO_DELETE="$(echo "$VERSIONS_JSON" | jq '{
        Objects: (
          ((.Versions // []) + (.DeleteMarkers // []))
          | map({Key: .Key, VersionId: .VersionId})
        ),
        Quiet: true
      }')"

      COUNT="$(echo "$OBJECTS_TO_DELETE" | jq '.Objects | length')"

      if [ "$COUNT" -gt 0 ]; then
        echo "Deleting $COUNT versioned objects/delete markers..."
        DELETE_RESULT=$(aws s3api delete-objects \
          --bucket "$BUCKET_NAME" \
          --region "$AWS_REGION" \
          --delete "$OBJECTS_TO_DELETE" --output json)
        if ! echo "$DELETE_RESULT" | jq -e '(.Errors // []) | length == 0' >/dev/null; then
          echo "$DELETE_RESULT" >&2
          exit 1
        fi
      fi

      IS_TRUNCATED="$(echo "$VERSIONS_JSON" | jq -r '.IsTruncated // false')"
      if [ "$IS_TRUNCATED" != "true" ]; then
        break
      fi

      KEY_MARKER="$(echo "$VERSIONS_JSON" | jq -r '.NextKeyMarker // ""')"
      VERSION_ID_MARKER="$(echo "$VERSIONS_JSON" | jq -r '.NextVersionIdMarker // ""')"
    done
  fi

  echo "Deleting stack: $STACK_NAME"
  aws cloudformation delete-stack \
    --stack-name "$STACK_NAME" \
    --region "$AWS_REGION"

fi

echo "Waiting for stack deletion to complete..."
for attempt in $(seq 1 180); do
  STATUS=$(aws cloudformation describe-stacks --stack-name "$STACK_ID" \
    --region "$AWS_REGION" --query 'Stacks[0].StackStatus' --output text)
  if [[ "$STATUS" == DELETE_COMPLETE ]]; then
    echo "Deleted stack: $STACK_NAME"
    exit 0
  fi
  if [[ "$STATUS" == DELETE_FAILED ]]; then
    aws cloudformation describe-stack-events --stack-name "$STACK_ID" \
      --region "$AWS_REGION" --query 'StackEvents[?ResourceStatus==`DELETE_FAILED`].[LogicalResourceId,ResourceStatusReason]' --output table >&2
    exit 1
  fi
  sleep 20
done
echo "Timed out waiting for deletion of $STACK_NAME ($STACK_ID)." >&2
exit 1

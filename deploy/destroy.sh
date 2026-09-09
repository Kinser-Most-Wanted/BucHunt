#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <stack-name>"
  exit 1
fi

STACK_NAME="$1"
AWS_REGION="${AWS_REGION:-us-east-1}"

echo "Resolving stack metadata for: $STACK_NAME"

STACK_ID="$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --query "Stacks[0].StackId" \
  --output text 2>/dev/null || true)"

BUCKET_NAME="$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$AWS_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='BucketName'].OutputValue" \
  --output text 2>/dev/null || true)"

if [ -n "${BUCKET_NAME:-}" ] && [ "$BUCKET_NAME" != "None" ]; then
  echo "Emptying versioned bucket: s3://$BUCKET_NAME"

  KEY_MARKER=""
  VERSION_ID_MARKER=""

  while true; do
    if [ -n "$KEY_MARKER" ]; then
      VERSIONS_JSON="$(aws s3api list-object-versions \
        --bucket "$BUCKET_NAME" \
        --region "$AWS_REGION" \
        --key-marker "$KEY_MARKER" \
        --version-id-marker "$VERSION_ID_MARKER" \
        --output json)"
    else
      VERSIONS_JSON="$(aws s3api list-object-versions \
        --bucket "$BUCKET_NAME" \
        --region "$AWS_REGION" \
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
      aws s3api delete-objects \
        --bucket "$BUCKET_NAME" \
        --region "$AWS_REGION" \
        --delete "$OBJECTS_TO_DELETE" >/dev/null
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

if [ -n "${STACK_ID:-}" ] && [ "$STACK_ID" != "None" ]; then
  echo "Waiting for stack deletion to complete..."
  aws cloudformation wait stack-delete-complete \
    --stack-name "$STACK_ID" \
    --region "$AWS_REGION"
fi

echo "Deleted stack: $STACK_NAME"

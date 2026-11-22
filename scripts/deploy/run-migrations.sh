#!/usr/bin/env bash
# Runs `prisma migrate deploy` as a one-off Fargate task (Vlp-Migrate stack) and fails if it fails.
# Must run AFTER `cdk deploy Vlp-Migrate` (new image tag) and BEFORE `cdk deploy Vlp-App`.
# Usage: scripts/deploy/run-migrations.sh
set -euo pipefail

REGION="${AWS_REGION:?set AWS_REGION}"
STACK="Vlp-Migrate"

output() {
  aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}

CLUSTER="$(output ClusterName)"
TASK_DEF="$(output TaskDefinitionArn)"
SG="$(output SecurityGroupId)"
SUBNETS="$(output SubnetIds)"
LOG_GROUP="$(output LogGroupName)"

echo "▶ running migrations with ${TASK_DEF##*/}"
TASK_ARN="$(aws ecs run-task --region "$REGION" \
  --cluster "$CLUSTER" \
  --task-definition "$TASK_DEF" \
  --launch-type FARGATE \
  --count 1 \
  --network-configuration "awsvpcConfiguration={subnets=[${SUBNETS}],securityGroups=[${SG}],assignPublicIp=ENABLED}" \
  --query 'tasks[0].taskArn' --output text)"

if [ -z "$TASK_ARN" ] || [ "$TASK_ARN" = "None" ]; then
  echo "::error::Failed to start the migration task"
  exit 1
fi
TASK_ID="${TASK_ARN##*/}"
echo "  task: $TASK_ID"

# `wait tasks-stopped` polls every 6 s for up to 10 minutes.
aws ecs wait tasks-stopped --region "$REGION" --cluster "$CLUSTER" --tasks "$TASK_ARN"

read -r EXIT_CODE STOP_REASON < <(aws ecs describe-tasks --region "$REGION" \
  --cluster "$CLUSTER" --tasks "$TASK_ARN" \
  --query 'tasks[0].[containers[0].exitCode, stoppedReason]' --output text)

echo "── migration logs ─────────────────────────────────────"
aws logs get-log-events --region "$REGION" \
  --log-group-name "$LOG_GROUP" --log-stream-name "migrate/migrate/${TASK_ID}" \
  --start-from-head --query 'events[].message' --output text 2>/dev/null | tr '\t' '\n' || true
echo "───────────────────────────────────────────────────────"

if [ "$EXIT_CODE" != "0" ]; then
  echo "::error::Migrations failed (exit code: ${EXIT_CODE}, reason: ${STOP_REASON})"
  exit 1
fi
echo "✅ migrations applied"

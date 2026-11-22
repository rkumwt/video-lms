#!/bin/sh
# Runs inside LocalStack once it is ready. Mirrors the S3/SQS resources CDK creates on AWS.
set -eu
REGION="${AWS_DEFAULT_REGION:-ap-south-1}"
BUCKET="vlp-videos-local"

awslocal s3 mb "s3://${BUCKET}" --region "$REGION" || true
awslocal s3api put-bucket-cors --bucket "$BUCKET" --cors-configuration '{
  "CORSRules": [{
    "AllowedOrigins": ["http://localhost:5173", "http://localhost:8080"],
    "AllowedMethods": ["GET", "PUT", "POST", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }]
}'

DLQ_URL=$(awslocal sqs create-queue --queue-name vlp-video-events-dlq --query QueueUrl --output text)
DLQ_ARN=$(awslocal sqs get-queue-attributes --queue-url "$DLQ_URL" \
  --attribute-names QueueArn --query Attributes.QueueArn --output text)

awslocal sqs create-queue --queue-name vlp-video-events --attributes "{
  \"VisibilityTimeout\": \"300\",
  \"RedrivePolicy\": \"{\\\"deadLetterTargetArn\\\":\\\"${DLQ_ARN}\\\",\\\"maxReceiveCount\\\":\\\"5\\\"}\"
}"

echo "LocalStack resources ready"

#!/usr/bin/env bash
# Build the api + worker images for linux/arm64 and push them to ECR, tagged with the git SHA.
# Usage: scripts/deploy/push-images.sh [tag]
# Needs: AWS credentials (AWS_PROFILE or OIDC in CI), AWS_REGION, Docker with buildx.
set -euo pipefail

REGION="${AWS_REGION:?set AWS_REGION}"
TAG="${1:-$(git rev-parse --short=12 HEAD)}"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
REGISTRY="${ACCOUNT}.dkr.ecr.${REGION}.amazonaws.com"

aws ecr get-login-password --region "$REGION" |
  docker login --username AWS --password-stdin "$REGISTRY"

for app in api worker; do
  image="${REGISTRY}/vlp/${app}:${TAG}"
  if aws ecr describe-images --region "$REGION" --repository-name "vlp/${app}" \
    --image-ids "imageTag=${TAG}" >/dev/null 2>&1; then
    echo "✔ ${image} already exists (tags are immutable), skipping"
    continue
  fi
  echo "▶ building ${image}"
  docker buildx build \
    --platform linux/arm64 \
    --file "apps/${app}/Dockerfile" \
    --build-arg "APP_VERSION=${TAG}" \
    --tag "$image" \
    --push \
    .
done

echo "IMAGE_TAG=${TAG}"

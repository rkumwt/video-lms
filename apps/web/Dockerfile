# syntax=docker/dockerfile:1.7
# Local / self-hosted image only. On AWS the static build is synced to S3 + CloudFront.
# Build context: repository root.  docker build -f apps/web/Dockerfile .

ARG NODE_IMAGE=node:24-slim

FROM ${NODE_IMAGE} AS base
ARG PNPM_VERSION=9.15.9
ARG TURBO_VERSION=2.11.13
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    HUSKY=0 \
    TURBO_TELEMETRY_DISABLED=1
RUN npm install -g pnpm@${PNPM_VERSION} turbo@${TURBO_VERSION} --no-fund --no-audit
WORKDIR /app

FROM base AS pruner
COPY . .
RUN turbo prune @vlp/web --docker

FROM base AS builder
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
# VITE_* values are baked in at build time (they are public, never secrets).
ARG VITE_API_URL=""
ENV VITE_API_URL=${VITE_API_URL}
RUN turbo run build --filter=@vlp/web

FROM nginxinc/nginx-unprivileged:1.29-alpine AS runner
COPY docker/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
ENV API_UPSTREAM=http://api:4000
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/ > /dev/null || exit 1

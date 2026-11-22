# syntax=docker/dockerfile:1.7
# Build context: repository root.  docker build -f apps/worker/Dockerfile .

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
RUN turbo prune @vlp/worker --docker

FROM base AS builder
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
RUN turbo run build --filter=@vlp/worker
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter=@vlp/worker deploy --prod /out

FROM ${NODE_IMAGE} AS runner
ARG APP_VERSION=dev
ENV NODE_ENV=production \
    APP_VERSION=${APP_VERSION}
WORKDIR /app
COPY --from=builder --chown=node:node /out/package.json ./package.json
COPY --from=builder --chown=node:node /out/node_modules ./node_modules
COPY --from=builder --chown=node:node /out/dist ./dist
USER node
CMD ["node", "--enable-source-maps", "dist/index.js"]

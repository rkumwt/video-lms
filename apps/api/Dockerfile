# syntax=docker/dockerfile:1.7
# Build context: repository root.  docker build -f apps/api/Dockerfile .

ARG NODE_IMAGE=node:24-slim

# ---- base: node + pnpm ------------------------------------------------------
FROM ${NODE_IMAGE} AS base
ARG PNPM_VERSION=9.15.9
ARG TURBO_VERSION=2.11.13
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    HUSKY=0 \
    TURBO_TELEMETRY_DISABLED=1
RUN npm install -g pnpm@${PNPM_VERSION} turbo@${TURBO_VERSION} --no-fund --no-audit
WORKDIR /app

# ---- pruner: keep only the files @vlp/api needs (better layer caching) -------
FROM base AS pruner
COPY . .
RUN turbo prune @vlp/api --docker

# ---- builder: install deps, build, create a standalone prod bundle ----------
FROM base AS builder
# 1) manifests + lockfile only -> this layer is cached until dependencies change
COPY --from=pruner /app/out/json/ .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile
# 2) sources
COPY --from=pruner /app/out/full/ .
RUN turbo run build --filter=@vlp/api
# 3) self-contained folder with prod deps only
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter=@vlp/api deploy --prod /out

# ---- runner: minimal runtime image -------------------------------------------
FROM ${NODE_IMAGE} AS runner
ARG APP_VERSION=dev
ENV NODE_ENV=production \
    PORT=4000 \
    APP_VERSION=${APP_VERSION}
WORKDIR /app
COPY --from=builder --chown=node:node /out/package.json ./package.json
COPY --from=builder --chown=node:node /out/node_modules ./node_modules
COPY --from=builder --chown=node:node /out/dist ./dist
USER node
EXPOSE 4000
# Used by docker compose; on ECS the task definition health check / ALB target group apply.
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "--enable-source-maps", "dist/server.js"]

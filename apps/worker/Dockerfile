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
# Amazon RDS CA bundle so TLS to RDS is verified (DB_SSL_CA on AWS).
# Create /etc/ssl first: if ADD creates it, it is root-only (0700) and Node, running as `node`,
# then crashes at startup reading /etc/ssl/openssl.cnf (exit 13).
RUN mkdir -p /etc/ssl/certs && chmod 755 /etc/ssl /etc/ssl/certs
ADD --chmod=644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem
WORKDIR /app
COPY --from=builder --chown=node:node /out/package.json ./package.json
COPY --from=builder --chown=node:node /out/node_modules ./node_modules
COPY --from=builder --chown=node:node /out/dist ./dist
USER node
CMD ["node", "--enable-source-maps", "dist/index.js"]

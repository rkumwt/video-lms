#!/bin/sh
# Applies pending Prisma migrations. Runs as a one-off ECS task (same image as the API) BEFORE the
# new API version rolls out, so new code never runs against an old schema.
set -eu
# On AWS (DB_SSL_CA set): Prisma's schema engine can only use a single CA certificate, so point it at
# the regional RDS root extracted at image build time. Verification stays strict.
if [ -n "${DB_SSL_CA:-}" ]; then
  export PRISMA_SSL_CA="${PRISMA_SSL_CA:-/etc/ssl/certs/rds-root-ca.pem}"
fi
cd /app/node_modules/@vlp/db
exec ./node_modules/.bin/prisma migrate deploy

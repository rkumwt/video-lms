#!/bin/sh
# Applies pending Prisma migrations. Runs as a one-off ECS task (same image as the API) BEFORE the
# new API version rolls out, so new code never runs against an old schema.
set -eu
cd /app/node_modules/@vlp/db
exec ./node_modules/.bin/prisma migrate deploy

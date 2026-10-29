#!/bin/sh
set -e

# Apply pending migrations before starting the API. Uses the Prisma CLI that is
# part of the image's node_modules; no interaction and no destructive resets.
cd /app/apps/api
npx prisma migrate deploy --schema=/app/prisma/schema.prisma

exec node dist/main.js

# syntax=docker/dockerfile:1
# Build context: repository root (see docker-compose.yml).

FROM node:22-alpine AS build
WORKDIR /app
ENV NODE_ENV=development

COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/shared-types/tsconfig.json packages/shared-types/
COPY packages/shared-types/tsconfig.cjs.json packages/shared-types/
COPY packages/shared-types/tsconfig.esm.json packages/shared-types/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --ignore-scripts

COPY packages/shared-types packages/shared-types
RUN npm run build -w @smart-finance/shared-types

COPY prisma prisma
COPY apps/api apps/api
RUN npx prisma generate && npm run build -w @smart-finance/api

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -S app && adduser -S app -G app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/shared-types/package.json ./packages/shared-types/package.json
COPY --from=build /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/prisma ./prisma
COPY deploy/entrypoint-api.sh /usr/local/bin/entrypoint-api.sh

RUN chmod +x /usr/local/bin/entrypoint-api.sh && chown -R app:app /app

USER app
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/v1/health/live || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint-api.sh"]

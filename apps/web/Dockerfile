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

COPY apps/web apps/web
RUN npm run build -w @smart-finance/web

FROM nginx:1.27-alpine AS runtime
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz || exit 1

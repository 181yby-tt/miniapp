# 构建上下文必须是仓库根目录：docker build -f server/Dockerfile .
FROM node:22-alpine AS web-build
WORKDIR /app
ARG PUBLIC_ORIGIN=""
ENV VITE_PUBLIC_ORIGIN=${PUBLIC_ORIGIN}
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY packages/client-core/package.json ./packages/client-core/package.json
COPY server/package.json ./server/package.json
RUN npm ci --no-audit --no-fund
COPY apps/web ./apps/web
COPY packages/client-core ./packages/client-core
RUN npm run build:web

FROM node:22-alpine AS dependencies
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
ENV DATA_FILE=/tmp/kexu-data.json

COPY --from=dependencies --chown=node:node /app/server/node_modules ./server/node_modules
COPY --from=web-build --chown=node:node /app/apps/web/dist ./apps/web/dist
COPY --chown=node:node server/src ./server/src
COPY --chown=node:node docs/schema.sql ./docs/schema.sql
COPY --chown=node:node admin-console.html ./admin-console.html
RUN chown -R node:node /app/server

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-8080}/api/health || exit 1

CMD ["node", "server/src/server.js"]

# ---- 构建阶段（安装 mysql2 依赖）----
FROM node:18-alpine AS builder
WORKDIR /app
COPY package.json ./
# mysql2 是生产依赖，必须安装
RUN npm install --omit=dev --no-audit --no-fund
COPY src ./src
# schema.sql 供运行时建表使用（store.js 解析路径为 /app/docs/schema.sql）
COPY docs/schema.sql ./docs/schema.sql

# ---- 运行阶段 ----
FROM node:18-alpine
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src

# 微信云托管默认注入 PORT（通常为 80）；本地未设置时回退 3000
ENV PORT=80
EXPOSE 80

# 声明健康检查（平台额外保险，主探活走 TCP/HTTP 端口）
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-80}/api/health || exit 1

CMD ["node", "src/server.js"]

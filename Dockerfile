FROM node:20-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/api/package.json backend/api/
COPY frontend/web/package.json frontend/web/

RUN npm ci

COPY backend/ backend/
COPY frontend/ frontend/

RUN mkdir -p backend/api/dist/public && npm run build

# ---

FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/api/package.json backend/api/
COPY frontend/web/package.json frontend/web/

RUN npm ci --omit=dev

COPY --from=builder /app/backend/api/dist backend/api/dist
COPY ecosystem.config.js ./

ENV NODE_ENV=production
EXPOSE 52416

CMD ["node", "backend/api/dist/server.js"]

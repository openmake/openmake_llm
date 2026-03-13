# ============================================
# OpenMake LLM - Multi-stage Docker Build
# ============================================

# --- Stage 1: Build ---
FROM node:22-slim AS builder

WORKDIR /app

# Copy workspace root package files
COPY package.json package-lock.json ./
COPY backend/api/package.json backend/api/
COPY frontend/web/package.json frontend/web/

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY backend/api/ backend/api/
COPY frontend/web/ frontend/web/
COPY services/ services/
COPY data/ data/
COPY scripts/ scripts/

# Build backend (tsc)
RUN cd backend/api && npx tsc

# Deploy frontend (copy static files into backend dist)
RUN mkdir -p backend/api/dist/public && \
    cp -r frontend/web/public/* backend/api/dist/public/

# --- Stage 2: Production ---
FROM node:22-slim

WORKDIR /app

# Copy workspace root package files
COPY package.json package-lock.json ./
COPY backend/api/package.json backend/api/
COPY frontend/web/package.json frontend/web/

# Install production dependencies only
RUN npm ci --omit=dev

# Copy built artifacts from builder
COPY --from=builder /app/backend/api/dist backend/api/dist

# Copy SQL schema files (needed at runtime for auto-init)
COPY services/database/init/ services/database/init/

# Copy data directory (shared data layer)
COPY data/ data/

# Create directories for uploads and user data
RUN mkdir -p backend/api/uploads /data/users

ENV NODE_ENV=production
ENV PORT=52416

EXPOSE 52416

CMD ["node", "backend/api/dist/server.js"]

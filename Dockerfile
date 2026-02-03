# ============================================
# OpenMake LLM - Node.js Monolith
# ============================================
FROM node:22-slim

WORKDIR /app

# Install system dependencies for native modules (bcrypt, pg, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ curl \
    && rm -rf /var/lib/apt/lists/*

# Copy package files first for better layer caching
COPY package.json package-lock.json ./
COPY backend/api/package.json backend/api/
COPY backend/core/package.json backend/core/
COPY database/package.json database/

# Install all dependencies (workspaces)
RUN npm ci --ignore-scripts 2>/dev/null || npm install

# Copy source code
COPY backend/ backend/
COPY database/ database/
COPY frontend/web/public/ frontend/web/public/
COPY server.js ./
COPY scripts/ scripts/

# Build TypeScript
RUN npm run build:backend 2>/dev/null || true

# Deploy frontend assets to backend dist
RUN bash scripts/deploy-frontend.sh 2>/dev/null || \
    (mkdir -p backend/api/dist/public && cp -r frontend/web/public/* backend/api/dist/public/)

# OCR traineddata (optional)
COPY eng.traineddata kor.traineddata ./

EXPOSE 52416

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=30s \
    CMD curl -f http://localhost:52416/health || exit 1

CMD ["node", "server.js"]

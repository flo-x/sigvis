# ── Stage 1: build the Vue frontend ────────────────────────────────────────
FROM node:18-alpine AS web-builder
WORKDIR /build/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ── Stage 2: production server ──────────────────────────────────────────────
FROM node:18-alpine
WORKDIR /app/server

# Install only production dependencies
COPY server/package*.json ./
RUN npm ci --omit=dev

# Copy server source
COPY server/ ./

# Copy built frontend into the location the server expects
COPY --from=web-builder /build/web/dist /app/web/dist

# Persistent data lives here (mount a named volume over this path)
RUN mkdir -p /app/server/data/dashboards

EXPOSE 3000

CMD ["node", "src/index.js"]

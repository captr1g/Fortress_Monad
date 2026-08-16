# ── Stage 1: Build & Dependencies ──
FROM node:20-alpine AS builder

WORKDIR /app

# Install build tools if native dependencies need compiling
RUN apk add --no-cache python3 make g++

# Copy package descriptors
COPY package*.json ./

# Install all dependencies (including devDependencies for TypeScript build)
RUN npm ci

# Copy source code and config
COPY tsconfig.json ./
COPY src/ ./src/

# Compile TypeScript & verify types
RUN npm run typecheck && npx tsc

# ── Stage 2: Production Runner ──
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Install runtime dependencies only
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled files and source for TSX execution
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src ./src
COPY tsconfig.json ./

# Expose Fastify port
EXPOSE 3000

# Health check endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/fortress/health || exit 1

# Start the Fastify backend server
CMD ["node", "--import", "tsx", "src/boot.ts"]

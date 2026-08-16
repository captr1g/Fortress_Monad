# ── Stage 1: Base & Dependencies ──
FROM node:20-alpine AS deps

WORKDIR /app

# Install libc compatibility
RUN apk add --no-cache libc6-compat

# Copy workspace descriptors
COPY package*.json ./
COPY apps/web/package*.json ./apps/web/
COPY packages/core/package*.json ./packages/core/

# Install all dependencies across workspaces
RUN npm ci

# ── Stage 2: Builder ──
FROM node:20-alpine AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY turbo.json ./
COPY tsconfig.json ./

# Copy packages and web application source
COPY packages/ ./packages/
COPY apps/ ./apps/

# Environment arguments for build-time embedding in Next.js
ARG NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
ARG NEXT_PUBLIC_MONAD_RPC_URL
ARG NEXT_PUBLIC_MONAD_TESTNET_RPC_URL
ARG NEXT_PUBLIC_BASE_RPC_URL
ARG NEXT_PUBLIC_MONAD_USDC_ADDRESS
ARG NEXT_PUBLIC_MONAD_WMON_ADDRESS
ARG NEXT_PUBLIC_MONAD_WETH_ADDRESS
ARG BACKEND_API_ORIGIN

ENV NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=$NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
ENV NEXT_PUBLIC_MONAD_RPC_URL=$NEXT_PUBLIC_MONAD_RPC_URL
ENV NEXT_PUBLIC_MONAD_TESTNET_RPC_URL=$NEXT_PUBLIC_MONAD_TESTNET_RPC_URL
ENV NEXT_PUBLIC_BASE_RPC_URL=$NEXT_PUBLIC_BASE_RPC_URL
ENV NEXT_PUBLIC_MONAD_USDC_ADDRESS=$NEXT_PUBLIC_MONAD_USDC_ADDRESS
ENV NEXT_PUBLIC_MONAD_WMON_ADDRESS=$NEXT_PUBLIC_MONAD_WMON_ADDRESS
ENV NEXT_PUBLIC_MONAD_WETH_ADDRESS=$NEXT_PUBLIC_MONAD_WETH_ADDRESS
ENV BACKEND_API_ORIGIN=$BACKEND_API_ORIGIN
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Build all packages and the Next.js web application
RUN npm run build

# ── Stage 3: Production Runner ──
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001
ENV NEXT_TELEMETRY_DISABLED=1

# Don't run production as root
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy built application and workspace files
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/web/package*.json ./apps/web/
COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next ./apps/web/.next

USER nextjs

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001 || exit 1

# Start the Next.js server on port 3001
CMD ["npm", "run", "start", "-w", "web"]

FROM node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vitest.config.ts vitest.integration.config.ts ./
COPY src ./src
COPY tests ./tests
RUN rm -rf dist && npm run build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY tsconfig.json ./
COPY src ./src

# Cloud Run injects its own PORT (default 8080) and expects the container to
# listen on it — the app already reads process.env.PORT, so no code change
# needed, just don't hardcode 3000 here.
EXPOSE 8080
CMD ["node", "--import", "tsx", "src/boot.ts"]

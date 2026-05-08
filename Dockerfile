# --- Build Stage ---
FROM node:20-slim AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci --no-audit

COPY . .
RUN npm run build

# --- Production Stage ---
FROM node:20-slim AS production
WORKDIR /app

# Security: non-root user
RUN groupadd -r appuser && useradd -r -g appuser appuser

# Copy built frontend, server source, and package files
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/server ./src/server
COPY --from=build /app/package*.json ./
COPY --from=build /app/tsconfig.json ./

# Production deps only (tsx is now a runtime dep)
RUN npm ci --omit=dev --no-audit && chown -R appuser:appuser /app

USER appuser

ENV PORT=8080
ENV NODE_ENV=production
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:8080/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Run the TypeScript server with tsx (runtime dep)
CMD ["npx", "tsx", "src/server/server.ts"]

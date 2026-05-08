# --- Build Stage ---
FROM node:20-slim AS build
WORKDIR /app

# Install dependencies first (cached layer)
COPY package*.json ./
RUN npm ci --no-audit

# Copy source and build
COPY . .
RUN npm run build

# --- Production Stage ---
FROM node:20-slim AS production
WORKDIR /app

# Security: run as non-root user
RUN groupadd -r appuser && useradd -r -g appuser appuser

# Copy only production files
COPY --from=build /app/dist ./dist
COPY --from=build /app/package*.json ./
COPY --from=build /app/src/server ./src/server

# Install production dependencies only
RUN npm ci --omit=dev --no-audit

# Security: switch to non-root user
USER appuser

# Cloud Run uses PORT environment variable
ENV PORT=8080
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:8080/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

CMD ["node", "--experimental-specifier-resolution=node", "src/server/server.ts"]

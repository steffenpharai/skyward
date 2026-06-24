# Skyward — single-service image: builds the client and serves it + the authoritative
# world server from one process. A single always-on instance IS the world; do NOT
# autoscale it (Cloud Run min=max=1, no CPU throttling — see docs/DEPLOY.md).

# --- build stage: compile the client (tsc + vite → dist/) ---
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

# --- runtime stage: server + built client, production deps only ---
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund   # includes ws + optional pg (Cloud SQL)
COPY server ./server
COPY docs ./docs
COPY --from=build /app/dist ./dist

# Cloud Run injects PORT (8080); the server honours it.
EXPOSE 8080
CMD ["node", "server/world.mjs"]

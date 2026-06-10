# ── Stage 1: Build React ───────────────────────────────────────────────────────
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ── Stage 2: nginx + node API server ──────────────────────────────────────────
FROM node:20-alpine
RUN apk add --no-cache nginx
COPY --from=builder /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/http.d/default.conf
COPY server.js /app/server.js
RUN echo '{"dependencies":{"express":"^4.18.0"}}' > /app/package.json && \
    cd /app && npm install --production
EXPOSE 5190
CMD sh -c "nginx && node /app/server.js"

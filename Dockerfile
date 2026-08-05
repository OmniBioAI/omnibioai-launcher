# ── Stage 1: Build React ───────────────────────────────────────────────────────
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# CRA inlines REACT_APP_* vars at build time (`npm run build`), not at container
# runtime -- setting them in docker-compose.yml's `environment:` only affects the
# already-built static bundle's process, which never reads them. They have to
# come in as build args here, or the src/*.jsx fallbacks (127.0.0.1:8000 etc.)
# are silently the only value that's ever actually compiled in.
ARG REACT_APP_OMNIBIOAI_BASE_URL
ARG REACT_APP_OMNIBIOAI_TOKEN
ARG REACT_APP_JUPYTER_BASE
ARG REACT_APP_JUPYTER_TOKEN
ARG REACT_APP_USE_MOCK
ENV REACT_APP_OMNIBIOAI_BASE_URL=$REACT_APP_OMNIBIOAI_BASE_URL \
    REACT_APP_OMNIBIOAI_TOKEN=$REACT_APP_OMNIBIOAI_TOKEN \
    REACT_APP_JUPYTER_BASE=$REACT_APP_JUPYTER_BASE \
    REACT_APP_JUPYTER_TOKEN=$REACT_APP_JUPYTER_TOKEN \
    REACT_APP_USE_MOCK=$REACT_APP_USE_MOCK
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
CMD sh -c "nginx && exec node /app/server.js"

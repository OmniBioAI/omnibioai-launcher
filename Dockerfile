# ── Stage 1: Build React ───────────────────────────────────────────────────────
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# CRA inlines every REACT_APP_* variable into the PUBLIC JavaScript bundle at
# build time (`npm run build`), not at container runtime. So only non-secret
# configuration may be passed here (URLs, feature flags). NEVER pass a token,
# password, API key or other reusable credential: it becomes readable by anyone
# who can download the bundle -- this UI once published its Jupyter token that
# way. The UI sends the signed-in user's own session token at runtime instead
# (src/session.js), and Jupyter authenticates the user itself.
# tests/no-browser-secret.test.mjs fails any change that reintroduces this.
ARG REACT_APP_OMNIBIOAI_BASE_URL
ARG REACT_APP_JUPYTER_BASE
ARG REACT_APP_USE_MOCK
ENV REACT_APP_OMNIBIOAI_BASE_URL=$REACT_APP_OMNIBIOAI_BASE_URL \
    REACT_APP_JUPYTER_BASE=$REACT_APP_JUPYTER_BASE \
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

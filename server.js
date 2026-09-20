const express = require('express');
const http = require('http');
const app = express();

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Authentication: every lifecycle route requires a verified IAM identity. The
// bearer token is confirmed with omnibioai-auth's /auth/validate (signature,
// expiry and revocation are decided there, not here), and this API fails CLOSED:
// no token, an invalid token, or an unreachable auth service all deny. Starting or
// stopping a tool is an infrastructure action on a shared container, so it also
// needs platform.manage_infra; reading status needs only a valid identity. CORS
// stays permissive because the credential is a bearer header, not an ambient
// cookie, so a foreign page cannot borrow a visitor's authority.
const IAM_URL = process.env.IAM_URL || 'http://auth-service:8001';
const CONTROL_PERMISSION = 'platform.manage_infra';

async function verifyIdentity(authorization) {
  const match = /^Bearer\s+(\S+)$/i.exec(authorization || '');
  if (!match) return { denied: 401, error: 'authentication required' };
  let response;
  try {
    response = await fetch(`${IAM_URL}/auth/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: match[1] }),
      signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined,
    });
  } catch {
    return { denied: 503, error: 'authentication service unavailable' };
  }
  if (!response.ok) return { denied: 503, error: 'authentication service unavailable' };
  const identity = await response.json().catch(() => null);
  if (!identity || identity.valid !== true) return { denied: 401, error: 'invalid or expired token' };
  return { identity };
}

function requireIdentity(permission) {
  return async (req, res, next) => {
    const result = await verifyIdentity(req.headers.authorization);
    if (result.denied) return res.status(result.denied).json({ error: result.error });
    if (permission && !(result.identity.permissions || []).includes(permission)) {
      return res.status(403).json({ error: 'insufficient permissions' });
    }
    req.identity = result.identity;
    next();
  };
}

const TOOLS = {
  jupyter: { container: 'omnibioai-jupyter', port: 8888 },
  rstudio: { container: 'omnibioai-rstudio', port: 8787 },
  vscode:  { container: 'omnibioai-vscode',  port: 8083 },
};

// #54: talk to the docker-socket-proxy's exposed socket, not the raw
// host one -- omnibioai-studio's docker-compose*.yml no longer mounts
// /var/run/docker.sock into this container directly. Defaults to the
// proxy's own path so this still works if DOCKER_SOCKET_PATH is unset
// somewhere this service is run from outside that compose file.
const DOCKER_SOCKET_PATH = process.env.DOCKER_SOCKET_PATH || '/var/run/proxy-socket/docker.sock';

function dockerRequest(method, path) {
  return new Promise((resolve, reject) => {
    const opts = {
      socketPath: DOCKER_SOCKET_PATH,
      path,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

app.get('/api/launcher/status/:tool', requireIdentity(), async (req, res) => {
  const tool = TOOLS[req.params.tool];
  if (!tool) return res.status(400).json({ error: 'unknown tool' });
  try {
    const r = await dockerRequest('GET', `/containers/${tool.container}/json`);
    if (r.status === 404) return res.json({ status: 'stopped' });
    const state = r.body?.State?.Status || 'stopped';
    res.json({ status: state });
  } catch {
    res.json({ status: 'stopped' });
  }
});

app.post('/api/launcher/start/:tool', requireIdentity(CONTROL_PERMISSION), async (req, res) => {
  const tool = TOOLS[req.params.tool];
  if (!tool) return res.status(400).json({ error: 'unknown tool' });
  try {
    await dockerRequest('POST', `/containers/${tool.container}/start`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/launcher/stop/:tool', requireIdentity(CONTROL_PERMISSION), async (req, res) => {
  const tool = TOOLS[req.params.tool];
  if (!tool) return res.status(400).json({ error: 'unknown tool' });
  try {
    await dockerRequest('POST', `/containers/${tool.container}/stop`);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(3001, '0.0.0.0', () => console.log('launcher api listening on 0.0.0.0:3001'));

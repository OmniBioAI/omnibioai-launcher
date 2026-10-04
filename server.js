const express = require('express');
const http = require('http');
const crypto = require('crypto');
const LAUNCHER_VERSION = process.env.LAUNCHER_VERSION || '0.1.0';
const { ValidationError } = require('./lib/errors');
const { listProfiles } = require('./lib/profiles');
const { limitsFromEnvironment, validateImage, validateWorkspaceRequest } = require('./lib/workspace-spec');
const { ConfigEnvironmentResolver } = require('./lib/environment-resolver');
const { createManifest } = require('./lib/manifest');
const { workspaceRequestFromRun } = require('./lib/run-resolver');
const app = express();

app.use(express.json({ limit: '64kb', strict: true }));

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
const manifests = new Map();

function manifestKey(identity, workspaceId) {
  return `${identity.organization_id}\u0000${identity.user_id}\u0000${workspaceId}`;
}

function authoritativeIdentity(identity) {
  const userId = identity?.user_id ?? identity?.sub ?? identity?.id;
  const organizationId = identity?.organization_id ?? identity?.org_id ?? identity?.tenant_id;
  // omnibioai-auth's own /auth/validate returns user_id/org_id as JSON
  // numbers (they're plain SQL integer primary keys, not stored as
  // strings anywhere) -- accept either a string or a number here rather
  // than demanding the caller's own type already be a string, then
  // normalize to a string for manifestKey's template-literal key below
  // (and everything else downstream that was already written assuming
  // a string). 0 is a legitimate id and must not be treated as missing,
  // so the emptiness check below is explicitly on the normalized string
  // being non-empty, not on numeric truthiness.
  const isIdLike = (v) => typeof v === 'string' || typeof v === 'number';
  if (!isIdLike(userId) || !isIdLike(organizationId)) return null;
  const normalizedUserId = String(userId);
  const normalizedOrganizationId = String(organizationId);
  if (!normalizedUserId || !normalizedOrganizationId) return null;
  return { user_id: normalizedUserId, organization_id: normalizedOrganizationId };
}

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

function dockerRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const opts = {
      socketPath: DOCKER_SOCKET_PATH,
      path,
      method,
      headers: { 'Content-Type': 'application/json', ...(payload && { 'Content-Length': Buffer.byteLength(payload) }) },
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
    req.end(payload);
  });
}

function apiError(res, error) {
  const status = Number.isInteger(error.status) ? error.status : error instanceof ValidationError ? 400 : 500;
  const body = { error: status === 500 ? 'workspace operation failed' : error.message };
  if (error instanceof ValidationError && error.details.length) body.details = error.details;
  return res.status(status).json(body);
}

function resolver() {
  return new ConfigEnvironmentResolver();
}

function dockerResourceUpdate(resources) {
  return Object.freeze({
    NanoCpus: Math.round(resources.cpu * 1_000_000_000),
    Memory: Math.round(resources.memory_bytes),
  });
}

function allocatedGpuCount(container) {
  const requests = Array.isArray(container.HostConfig?.DeviceRequests) ? container.HostConfig.DeviceRequests : [];
  return requests.reduce((total, request) => {
    const capabilities = Array.isArray(request.Capabilities) ? request.Capabilities.flat() : [];
    if (!capabilities.includes('gpu')) return total;
    if (Array.isArray(request.DeviceIDs) && request.DeviceIDs.length) return total + request.DeviceIDs.length;
    return total + (Number.isInteger(request.Count) && request.Count > 0 ? request.Count : 0);
  }, 0);
}

async function inspectEnvironment(candidate, requestedArchitecture, requestedGpu = 0) {
  const container = await dockerRequest('GET', `/containers/${candidate.container}/json`);
  if (container.status === 404) {
    const error = new Error('configured workspace container does not exist');
    error.status = 422;
    throw error;
  }
  if (container.status < 200 || container.status >= 300 || !container.body || typeof container.body !== 'object') {
    const error = new Error('configured workspace container could not be inspected');
    error.status = 503;
    throw error;
  }
  const imageId = container.body.Image;
  const imageInfo = imageId ? await dockerRequest('GET', `/images/${encodeURIComponent(imageId)}/json`) : null;
  if (!imageInfo || imageInfo.status < 200 || imageInfo.status >= 300 || !imageInfo.body || typeof imageInfo.body !== 'object') {
    const error = new Error('workspace image metadata could not be inspected');
    error.status = 503;
    throw error;
  }
  if (imageInfo.body.Architecture !== requestedArchitecture) {
    const error = new Error('workspace image architecture is incompatible with the request');
    error.status = 422;
    throw error;
  }
  if (requestedGpu > allocatedGpuCount(container.body)) {
    const error = new Error('workspace container does not have the requested GPU allocation');
    error.status = 422;
    throw error;
  }
  const configuredReference = candidate.image_reference || container.body.Config?.Image;
  const repoDigest = Array.isArray(imageInfo.body.RepoDigests) ? imageInfo.body.RepoDigests[0] : undefined;
  const digestFromRepo = typeof repoDigest === 'string' ? repoDigest.match(/@(sha256:[a-f0-9]{64})$/)?.[1] : undefined;
  const image = validateImage({
    reference: configuredReference,
    ...(candidate.image_digest || digestFromRepo || (/^sha256:[a-f0-9]{64}$/.test(imageId || '') ? imageId : undefined)
      ? { digest: candidate.image_digest || digestFromRepo || imageId } : {}),
  });
  return { container: container.body, image };
}

function requireAuthoritativeIdentity(req, res) {
  const identity = authoritativeIdentity(req.identity);
  if (!identity) {
    res.status(403).json({ error: 'authenticated IAM identity lacks user or organization context' });
    return null;
  }
  return identity;
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

// Versioned workspace APIs are additive. Legacy lifecycle routes above retain
// their exact behavior for existing Studio consumers.
app.get('/api/launcher/v1/profiles', requireIdentity(), (req, res) => {
  res.json({ profiles: listProfiles(), resource_limits: limitsFromEnvironment() });
});

app.post('/api/launcher/v1/workspaces/validate', requireIdentity(), (req, res) => {
  const identity = requireAuthoritativeIdentity(req, res);
  if (!identity) return;
  try {
    const specification = validateWorkspaceRequest(req.body, { identity, launcherVersion: LAUNCHER_VERSION });
    const environment = resolver().resolve(specification);
    res.json({ specification, environment: { id: environment.id, ide: environment.ide, architectures: environment.architectures, capabilities: environment.capabilities, gpu_available: environment.gpu_available } });
  } catch (error) { apiError(res, error); }
});

app.post('/api/launcher/v1/workspaces', requireIdentity(CONTROL_PERMISSION), async (req, res) => {
  const identity = requireAuthoritativeIdentity(req, res);
  if (!identity) return;
  try {
    const specification = validateWorkspaceRequest(req.body, { identity, launcherVersion: LAUNCHER_VERSION });
    // An object identifier is context, never authority. Until an authoritative
    // object-access contract is configured, object-aware provisioning denies.
    if (specification.objects.length) {
      const error = new Error('object authorization integration is not configured');
      error.status = 501;
      throw error;
    }
    const environment = resolver().resolve(specification);
    const workspaceId = specification.workspace.id || crypto.randomUUID();
    const storageKey = manifestKey(identity, workspaceId);
    if (manifests.has(storageKey)) {
      const error = new Error('workspace id already exists');
      error.status = 409;
      throw error;
    }
    const inspected = await inspectEnvironment(environment, specification.resources.architecture, specification.resources.gpu);
    const manifest = createManifest({ spec: specification, environment, workspaceId, image: inspected.image });
    if (inspected.container.State?.Running) {
      const error = new Error('resource settings cannot be changed while the shared workspace container is running');
      error.status = 409;
      throw error;
    }
    const updated = await dockerRequest('POST', `/containers/${environment.container}/update`, dockerResourceUpdate(specification.resources));
    if (updated.status < 200 || updated.status >= 300) {
      const error = new Error('workspace resource limits could not be applied');
      error.status = 502;
      throw error;
    }
    const started = await dockerRequest('POST', `/containers/${environment.container}/start`);
    if (![204, 304].includes(started.status)) {
      const error = new Error('workspace container did not start');
      error.status = 502;
      throw error;
    }
    manifests.set(storageKey, manifest);
    res.status(201).json({ workspace_id: workspaceId, status: 'started', manifest });
  } catch (error) { apiError(res, error); }
});

app.get('/api/launcher/v1/workspaces/:workspaceId/manifest', requireIdentity(), (req, res) => {
  const identity = requireAuthoritativeIdentity(req, res);
  if (!identity) return;
  const manifest = manifests.get(manifestKey(identity, req.params.workspaceId));
  if (!manifest || manifest.identity.user_id !== identity.user_id || manifest.identity.organization_id !== identity.organization_id) {
    return res.status(404).json({ error: 'workspace manifest not found' });
  }
  res.json(manifest);
});

app.post('/api/launcher/v1/workspaces/from-run', requireIdentity(CONTROL_PERMISSION), async (req, res) => {
  const identity = requireAuthoritativeIdentity(req, res);
  if (!identity) return;
  try {
    if (!req.body || Object.keys(req.body).some((key) => key !== 'run_reference')) throw new ValidationError('request must contain only run_reference');
    await workspaceRequestFromRun(req.body.run_reference, {});
    res.status(500).json({ error: 'unexpected run resolver response' });
  } catch (error) { apiError(res, error); }
});

app.listen(3001, '0.0.0.0', () => console.log('launcher api listening on 0.0.0.0:3001'));

module.exports = { allocatedGpuCount, app, authoritativeIdentity, dockerResourceUpdate, inspectEnvironment, manifestKey, manifests };

const EventEmitter = require('events');
const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

let mockApp;
let mockDockerRequest;

jest.mock('express', () => {
  const realExpress = jest.requireActual('express');
  const factory = (...args) => {
    mockApp = realExpress(...args);
    mockApp.listen = jest.fn((port, host, callback) => callback && callback());
    return mockApp;
  };
  Object.assign(factory, realExpress);
  return factory;
});

jest.mock('http', () => {
  const actual = jest.requireActual('http');
  return { ...actual, request: (options, callback) => mockDockerRequest(options, callback) };
});
const serverModule = require('../server');

function requestApp(method, url, headers = {}) {
  return new Promise((resolve) => {
    const req = new EventEmitter();
    // Node lowercases incoming header names; mirror that so the fake request behaves like a real one.
    const lowered = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
    Object.assign(req, { method, url, originalUrl: url, headers: lowered, connection: {} });
    const response = new EventEmitter();
    response.statusCode = 200;
    response.headers = {};
    response.setHeader = (name, value) => { response.headers[name.toLowerCase()] = value; };
    response.getHeader = (name) => response.headers[name.toLowerCase()];
    response.status = (code) => { response.statusCode = code; return response; };
    response.json = (body) => resolve({ status: response.statusCode, body, headers: response.headers });
    response.sendStatus = (code) => { response.statusCode = code; resolve({ status: code, body: undefined, headers: response.headers }); };
    response.end = () => resolve({ status: response.statusCode, body: undefined, headers: response.headers });
    mockApp.handle(req, response, () => resolve({ status: response.statusCode, body: undefined, headers: response.headers }));
  });
}

function dockerReply(statusCode, body, error) {
  mockDockerRequest = jest.fn((options, callback) => {
    const request = new EventEmitter();
    request.end = () => {
      if (error) return process.nextTick(() => request.emit('error', error));
      const response = new EventEmitter();
      response.statusCode = statusCode;
      process.nextTick(() => {
        callback(response);
        response.emit('data', typeof body === 'string' ? body : JSON.stringify(body));
        response.emit('end');
      });
    };
    return request;
  });
}

function dockerReplySequence(replies) {
  mockDockerRequest = jest.fn((options, callback) => {
    const request = new EventEmitter();
    request.end = () => {
      const reply = replies.shift();
      if (reply.error) return process.nextTick(() => request.emit('error', reply.error));
      const response = new EventEmitter();
      response.statusCode = reply.statusCode;
      process.nextTick(() => {
        callback(response);
        response.emit('data', JSON.stringify(reply.body));
        response.emit('end');
      });
    };
    return request;
  });
}


const GOOD = { Authorization: 'Bearer valid-user-token' };

// Stubs omnibioai-auth's POST /auth/validate.
function iamReply(body, { ok = true, error } = {}) {
  global.fetch = jest.fn(() => (error ? Promise.reject(error) : Promise.resolve({ ok, json: async () => body })));
}
const ADMIN = { valid: true, permissions: ['platform.manage_infra'] };
const PLAIN_USER = { valid: true, permissions: ['dataset.read'] };

describe('launcher Express API', () => {
  beforeEach(() => { iamReply(ADMIN); });

  test('rejects unknown tools and handles CORS preflight', async () => {
    expect(await requestApp('GET', '/api/launcher/status/nope', GOOD)).toMatchObject({ status: 400, body: { error: 'unknown tool' } });
    const response = await requestApp('OPTIONS', '/api/launcher/status/jupyter');
    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('*');
    expect(response.headers['access-control-allow-methods']).toBe('GET, POST, OPTIONS');
  });

  test('returns Docker status, defaults missing state to stopped, and parses text bodies', async () => {
    dockerReply(200, { State: { Status: 'running' } });
    expect(await requestApp('GET', '/api/launcher/status/jupyter', GOOD)).toMatchObject({ status: 200, body: { status: 'running' } });
    expect(mockDockerRequest).toHaveBeenCalledWith(expect.objectContaining({ path: '/containers/omnibioai-jupyter/json', method: 'GET' }), expect.any(Function));

    dockerReply(200, {});
    expect(await requestApp('GET', '/api/launcher/status/vscode', GOOD)).toMatchObject({ status: 200, body: { status: 'stopped' } });
    dockerReply(200, 'not-json');
    expect(await requestApp('GET', '/api/launcher/status/rstudio', GOOD)).toMatchObject({ status: 200, body: { status: 'stopped' } });
    dockerReply(404, { message: 'missing' });
    expect(await requestApp('GET', '/api/launcher/status/jupyter', GOOD)).toMatchObject({ status: 200, body: { status: 'stopped' } });
    dockerReply(200, { State: { Status: 'running' } });
    expect(await requestApp('GET', '/api/launcher/status/terminal', GOOD)).toMatchObject({ status: 200, body: { status: 'running' } });
    expect(mockDockerRequest).toHaveBeenCalledWith(expect.objectContaining({ path: '/containers/omnibioai-vscode/json', method: 'GET' }), expect.any(Function));
  });

  test('returns success for start/stop and reports Docker failures', async () => {
    dockerReply(200, {});
    expect(await requestApp('POST', '/api/launcher/start/jupyter', GOOD)).toMatchObject({ status: 200, body: { ok: true } });
    expect(mockDockerRequest).toHaveBeenCalledWith(expect.objectContaining({ path: '/containers/omnibioai-jupyter/start', method: 'POST' }), expect.any(Function));
    dockerReply(200, {});
    expect(await requestApp('POST', '/api/launcher/stop/rstudio', GOOD)).toMatchObject({ status: 200, body: { ok: true } });
    dockerReply(500, {}, new Error('socket unavailable'));
    expect(await requestApp('POST', '/api/launcher/start/vscode', GOOD)).toMatchObject({ status: 500, body: { error: 'socket unavailable' } });
    dockerReply(500, {}, new Error('socket unavailable'));
    expect(await requestApp('POST', '/api/launcher/stop/vscode', GOOD)).toMatchObject({ status: 500, body: { error: 'socket unavailable' } });
    expect(await requestApp('POST', '/api/launcher/start/nope', GOOD)).toMatchObject({ status: 400, body: { error: 'unknown tool' } });
  });

  test('falls back to stopped when status Docker lookup fails', async () => {
    dockerReply(500, {}, new Error('daemon unavailable'));
    expect(await requestApp('GET', '/api/launcher/status/jupyter', GOOD)).toMatchObject({ status: 200, body: { status: 'stopped' } });
  });

  test('inspects immutable image metadata and rejects architecture mismatch', async () => {
    const digest = `sha256:${'a'.repeat(64)}`;
    const candidate = { container: 'omnibioai-jupyter', image_reference: 'registry.example.test/runtime:1' };
    dockerReplySequence([
      { statusCode: 200, body: { Image: digest, Config: { Image: candidate.image_reference }, State: { Running: false } } },
      { statusCode: 200, body: { Architecture: 'amd64', RepoDigests: [`registry.example.test/runtime@${digest}`] } },
    ]);
    await expect(serverModule.inspectEnvironment(candidate, 'amd64')).resolves.toMatchObject({ image: { reference: candidate.image_reference, digest } });

    dockerReplySequence([
      { statusCode: 200, body: { Image: digest, Config: { Image: candidate.image_reference } } },
      { statusCode: 200, body: { Architecture: 'arm64', RepoDigests: [] } },
    ]);
    await expect(serverModule.inspectEnvironment(candidate, 'amd64')).rejects.toMatchObject({ status: 422 });
  });

  test('GPU inspection accepts only explicitly pre-provisioned Docker GPU allocations', () => {
    expect(serverModule.allocatedGpuCount({ HostConfig: {} })).toBe(0);
    expect(serverModule.allocatedGpuCount({ HostConfig: { DeviceRequests: [
      { Capabilities: [['gpu']], Count: 2 },
      { Capabilities: [['gpu']], DeviceIDs: ['GPU-a'] },
      { Capabilities: [['compute']], Count: 99 },
    ] } })).toBe(3);
  });

  describe('authentication (fails closed)', () => {
    const ROUTES = [
      ['GET', '/api/launcher/status/jupyter'], ['POST', '/api/launcher/start/jupyter'], ['POST', '/api/launcher/stop/jupyter'],
      ['GET', '/api/launcher/status/terminal'], ['POST', '/api/launcher/start/terminal'], ['POST', '/api/launcher/stop/terminal'],
      ['GET', '/api/launcher/v1/profiles'], ['GET', '/api/launcher/v1/workspaces/example/manifest'],
      ['POST', '/api/launcher/v1/workspaces'], ['POST', '/api/launcher/v1/workspaces/from-run'],
    ];

    test('the CORS preflight needs no credentials', async () => {
      expect((await requestApp('OPTIONS', '/api/launcher/start/jupyter')).status).toBe(204);
    });

    test.each(ROUTES)('%s %s with no credentials is 401 and never reaches Docker', async (method, url) => {
      dockerReply(200, {});
      for (const headers of [{}, { Authorization: '' }, { Authorization: 'Bearer' }, { Authorization: 'Basic abc' }]) {
        expect(await requestApp(method, url, headers)).toMatchObject({ status: 401, body: { error: 'authentication required' } });
      }
      expect(mockDockerRequest).not.toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test.each(ROUTES)('%s %s with an invalid or expired token is 401 and never reaches Docker', async (method, url) => {
      dockerReply(200, {});
      iamReply({ valid: false });
      expect(await requestApp(method, url, GOOD)).toMatchObject({ status: 401 });
      iamReply({});
      expect(await requestApp(method, url, GOOD)).toMatchObject({ status: 401 });
      iamReply(null);
      expect(await requestApp(method, url, GOOD)).toMatchObject({ status: 401 });
      expect(mockDockerRequest).not.toHaveBeenCalled();
    });

    test.each(ROUTES)('%s %s is 503, not open, when the auth service is unavailable', async (method, url) => {
      dockerReply(200, {});
      iamReply({ valid: true, permissions: ['platform.manage_infra'] }, { error: new Error('connect ECONNREFUSED') });
      expect(await requestApp(method, url, GOOD)).toMatchObject({ status: 503 });
      iamReply({ valid: true, permissions: ['platform.manage_infra'] }, { ok: false });
      expect(await requestApp(method, url, GOOD)).toMatchObject({ status: 503 });
      expect(mockDockerRequest).not.toHaveBeenCalled();
    });

    test('the token is confirmed with omnibioai-auth, not trusted locally', async () => {
      dockerReply(200, { State: { Status: 'running' } });
      await requestApp('GET', '/api/launcher/status/jupyter', GOOD);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringMatching(/\/auth\/validate$/),
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ token: 'valid-user-token' }) })
      );
    });

    test('a valid identity without platform.manage_infra may read status but not start or stop', async () => {
      iamReply(PLAIN_USER);
      dockerReply(200, { State: { Status: 'running' } });
      expect(await requestApp('GET', '/api/launcher/status/jupyter', GOOD)).toMatchObject({ status: 200, body: { status: 'running' } });
      dockerReply(200, {});
      expect(await requestApp('POST', '/api/launcher/start/jupyter', GOOD)).toMatchObject({ status: 403, body: { error: 'insufficient permissions' } });
      expect(await requestApp('POST', '/api/launcher/stop/jupyter', GOOD)).toMatchObject({ status: 403 });
      expect(await requestApp('POST', '/api/launcher/v1/workspaces', GOOD)).toMatchObject({ status: 403 });
      expect(await requestApp('POST', '/api/launcher/v1/workspaces/from-run', GOOD)).toMatchObject({ status: 403 });
      expect(mockDockerRequest).not.toHaveBeenCalledWith(expect.objectContaining({ method: 'POST' }), expect.anything());
    });

    test('authentication is checked before the tool is validated', async () => {
      expect(await requestApp('GET', '/api/launcher/status/nope')).toMatchObject({ status: 401 });
    });

    test('resource translation emits only bounded Docker CPU and memory controls', () => {
      const update = serverModule.dockerResourceUpdate({ cpu: 1.5, memory_bytes: 536870912, privileged: true, mounts: ['/host'] });
      expect(update).toEqual({ NanoCpus: 1500000000, Memory: 536870912 });
      expect(Object.keys(update)).toEqual(['NanoCpus', 'Memory']);
    });

    test('workspace manifests are isolated by both user and organization', async () => {
      const owner = { user_id: 'owner', organization_id: 'org-a' };
      const key = serverModule.manifestKey(owner, 'private-workspace');
      serverModule.manifests.set(key, { identity: owner });
      iamReply({ valid: true, user_id: 'owner', organization_id: 'org-b', permissions: [] });
      expect(await requestApp('GET', '/api/launcher/v1/workspaces/private-workspace/manifest', GOOD)).toMatchObject({ status: 404 });
      iamReply({ valid: true, user_id: 'other', organization_id: 'org-a', permissions: [] });
      expect(await requestApp('GET', '/api/launcher/v1/workspaces/private-workspace/manifest', GOOD)).toMatchObject({ status: 404 });
      iamReply({ valid: true, user_id: 'owner', organization_id: 'org-a', permissions: [] });
      expect(await requestApp('GET', '/api/launcher/v1/workspaces/private-workspace/manifest', GOOD)).toMatchObject({ status: 200 });
      serverModule.manifests.delete(key);
    });

    test('a numeric user_id/org_id (the real shape omnibioai-auth/validate returns -- plain SQL integer primary keys, never stored as strings) is accepted, not rejected as lacking org context', async () => {
      // Reproduces a real production bug: authoritativeIdentity used to
      // require typeof === 'string' for both ids, which every real
      // account with actual org membership fails (the field is also
      // literally named org_id in the real response, not
      // organization_id, but the fallback chain already covers that --
      // this test is specifically about the numeric-vs-string type gap).
      // platform.manage_infra so this request reaches
      // requireAuthoritativeIdentity at all, rather than being rejected
      // earlier for insufficient permissions and trivially passing this
      // assertion for the wrong reason.
      iamReply({ ...ADMIN, user_id: 6, org_id: 1 });
      dockerReply(200, { Id: 'container-1' });
      const response = await requestApp('POST', '/api/launcher/v1/workspaces', GOOD);
      expect(response.body).not.toMatchObject({ error: 'authenticated IAM identity lacks user or organization context' });
      expect(response.status).not.toBe(403);
    });

    test('authoritativeIdentity normalizes numeric ids to strings and still rejects 0/absent ids', () => {
      expect(serverModule.authoritativeIdentity({ user_id: 6, org_id: 1 })).toEqual({ user_id: '6', organization_id: '1' });
      expect(serverModule.authoritativeIdentity({ user_id: 'u1', organization_id: 'org-a' })).toEqual({ user_id: 'u1', organization_id: 'org-a' });
      expect(serverModule.authoritativeIdentity({ user_id: 6 })).toBeNull();
      expect(serverModule.authoritativeIdentity({ org_id: 1 })).toBeNull();
      expect(serverModule.authoritativeIdentity({})).toBeNull();
      expect(serverModule.authoritativeIdentity(null)).toBeNull();
    });

    test('workspace.launch alone (without platform.manage_infra) is sufficient to start, stop, and create a workspace -- a self-service permission, not platform-infra admin', async () => {
      iamReply({ valid: true, user_id: 6, org_id: 1, permissions: ['workspace.launch'] });
      dockerReply(200, { Id: 'container-1' });
      expect((await requestApp('POST', '/api/launcher/start/jupyter', GOOD)).status).not.toBe(403);
      dockerReply(200, {});
      expect((await requestApp('POST', '/api/launcher/stop/jupyter', GOOD)).status).not.toBe(403);
      expect((await requestApp('POST', '/api/launcher/v1/workspaces', GOOD)).status).not.toBe(403);
    });

    test('neither platform.manage_infra nor workspace.launch is still insufficient', async () => {
      iamReply({ valid: true, user_id: 6, org_id: 1, permissions: ['dataset.read'] });
      expect(await requestApp('POST', '/api/launcher/start/jupyter', GOOD)).toMatchObject({
        status: 403, body: { error: 'insufficient permissions' },
      });
    });
  });
});

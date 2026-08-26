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
require('../server');

function requestApp(method, url) {
  return new Promise((resolve) => {
    const req = new EventEmitter();
    Object.assign(req, { method, url, originalUrl: url, headers: {}, connection: {} });
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

describe('launcher Express API', () => {
  test('rejects unknown tools and handles CORS preflight', async () => {
    expect(await requestApp('GET', '/api/launcher/status/nope')).toMatchObject({ status: 400, body: { error: 'unknown tool' } });
    const response = await requestApp('OPTIONS', '/api/launcher/status/jupyter');
    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('*');
    expect(response.headers['access-control-allow-methods']).toBe('GET, POST, OPTIONS');
  });

  test('returns Docker status, defaults missing state to stopped, and parses text bodies', async () => {
    dockerReply(200, { State: { Status: 'running' } });
    expect(await requestApp('GET', '/api/launcher/status/jupyter')).toMatchObject({ status: 200, body: { status: 'running' } });
    expect(mockDockerRequest).toHaveBeenCalledWith(expect.objectContaining({ path: '/containers/omnibioai-jupyter/json', method: 'GET' }), expect.any(Function));

    dockerReply(200, {});
    expect(await requestApp('GET', '/api/launcher/status/vscode')).toMatchObject({ status: 200, body: { status: 'stopped' } });
    dockerReply(200, 'not-json');
    expect(await requestApp('GET', '/api/launcher/status/rstudio')).toMatchObject({ status: 200, body: { status: 'stopped' } });
    dockerReply(404, { message: 'missing' });
    expect(await requestApp('GET', '/api/launcher/status/jupyter')).toMatchObject({ status: 200, body: { status: 'stopped' } });
  });

  test('returns success for start/stop and reports Docker failures', async () => {
    dockerReply(200, {});
    expect(await requestApp('POST', '/api/launcher/start/jupyter')).toMatchObject({ status: 200, body: { ok: true } });
    expect(mockDockerRequest).toHaveBeenCalledWith(expect.objectContaining({ path: '/containers/omnibioai-jupyter/start', method: 'POST' }), expect.any(Function));
    dockerReply(200, {});
    expect(await requestApp('POST', '/api/launcher/stop/rstudio')).toMatchObject({ status: 200, body: { ok: true } });
    dockerReply(500, {}, new Error('socket unavailable'));
    expect(await requestApp('POST', '/api/launcher/start/vscode')).toMatchObject({ status: 500, body: { error: 'socket unavailable' } });
    dockerReply(500, {}, new Error('socket unavailable'));
    expect(await requestApp('POST', '/api/launcher/stop/vscode')).toMatchObject({ status: 500, body: { error: 'socket unavailable' } });
    expect(await requestApp('POST', '/api/launcher/start/nope')).toMatchObject({ status: 400, body: { error: 'unknown tool' } });
  });

  test('falls back to stopped when status Docker lookup fails', async () => {
    dockerReply(500, {}, new Error('daemon unavailable'));
    expect(await requestApp('GET', '/api/launcher/status/jupyter')).toMatchObject({ status: 200, body: { status: 'stopped' } });
  });
});

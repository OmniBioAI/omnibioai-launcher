const fs = require('fs');
const os = require('os');
const path = require('path');
const { ManifestStore, STATE_FILE } = require('../lib/manifest-store');

const OWNER = { user_id: 'u1', organization_id: 'org-a' };

function manifest(identity = OWNER, workspaceId = 'ws-1', overrides = {}) {
  return {
    schema_version: '1.0', workspace_id: workspaceId, profile: 'generic-python', ide: 'jupyterlab',
    image: { reference: 'registry.example.test/jupyter:1', digest: `sha256:${'a'.repeat(64)}` },
    resources: { cpu: 2, memory_bytes: 4 * 1024 ** 3, gpu: 0, architecture: 'amd64' }, objects: [],
    identity, created_at: '2026-11-01T00:00:00.000Z', launcher_version: '0.1.0', environment: {}, provenance: {},
    ...overrides,
  };
}

describe('ManifestStore', () => {
  let dir;
  const logger = { error: jest.fn() };
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-store-'));
    logger.error.mockClear();
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = () => path.join(dir, STATE_FILE);

  test('persists manifests and reloads them in a new instance', () => {
    new ManifestStore({ dir, logger }).set(OWNER, 'ws-1', manifest());
    const reloaded = new ManifestStore({ dir, logger });
    expect(reloaded.get(OWNER, 'ws-1')).toMatchObject({ workspace_id: 'ws-1', identity: OWNER });
    expect(fs.statSync(file()).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(dir)).toEqual([STATE_FILE]);
  });

  test('keys by organization + user + workspace id', () => {
    const store = new ManifestStore({ dir, logger });
    store.set(OWNER, 'ws-1', manifest());
    expect(store.get({ ...OWNER, organization_id: 'org-b' }, 'ws-1')).toBeNull();
    expect(store.get({ ...OWNER, user_id: 'u2' }, 'ws-1')).toBeNull();
    expect(store.get(OWNER, 'ws-2')).toBeNull();
    expect(store.has(OWNER, 'ws-1')).toBe(true);
  });

  test('validates on write: rejects invalid, secret-bearing, or mis-keyed manifests and writes nothing', () => {
    const store = new ManifestStore({ dir, logger });
    expect(() => store.set(OWNER, 'ws-1', { identity: OWNER })).toThrow();
    expect(() => store.set(OWNER, 'ws-1', manifest(OWNER, 'ws-1', { environment: { api_key: 'x' } }))).toThrow(/secret|unsafe/);
    expect(() => store.set({ ...OWNER, user_id: 'u2' }, 'ws-1', manifest())).toThrow(/storage key/);
    expect(() => store.set(OWNER, 'ws-other', manifest())).toThrow(/storage key/);
    expect(store.has(OWNER, 'ws-1')).toBe(false);
    expect(fs.existsSync(file())).toBe(false);
  });

  test('validates on read: skips tampered or mis-keyed entries in the state file', () => {
    fs.writeFileSync(file(), JSON.stringify({
      version: 1,
      manifests: [
        { ...OWNER, workspace_id: 'ok', manifest: manifest(OWNER, 'ok') },
        { ...OWNER, workspace_id: 'secret', manifest: manifest(OWNER, 'secret', { environment: { token: 'leak' } }) },
        { user_id: 'attacker', organization_id: 'org-a', workspace_id: 'stolen', manifest: manifest(OWNER, 'stolen') },
        { ...OWNER, workspace_id: 'mismatch', manifest: manifest(OWNER, 'other-id') },
        null,
      ],
    }));
    const store = new ManifestStore({ dir, logger });
    expect(store.get(OWNER, 'ok')).not.toBeNull();
    expect(store.has(OWNER, 'secret')).toBe(false);
    expect(store.get({ user_id: 'attacker', organization_id: 'org-a' }, 'stolen')).toBeNull();
    expect(store.has(OWNER, 'mismatch')).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(/skipped 4 invalid/));
  });

  test('re-validates entries when serving them', () => {
    const store = new ManifestStore({ dir, logger });
    store.set(OWNER, 'ws-1', manifest());
    const [entry] = store.entries.values();
    entry.serialized = JSON.stringify({ ...JSON.parse(entry.serialized), password: 'x' });
    expect(store.get(OWNER, 'ws-1')).toBeNull();
  });

  test('moves an unreadable state file aside instead of overwriting it', () => {
    fs.writeFileSync(file(), '{not json');
    const store = new ManifestStore({ dir, logger });
    expect(store.entries.size).toBe(0);
    expect(fs.readdirSync(dir).some((name) => name.startsWith(`${STATE_FILE}.corrupt-`))).toBe(true);
    expect(fs.existsSync(file())).toBe(false);
  });

  test('a failed write leaves the previous file intact and rolls back memory', () => {
    const store = new ManifestStore({ dir, logger });
    store.set(OWNER, 'ws-1', manifest());
    const before = fs.readFileSync(file(), 'utf8');
    const rename = jest.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('disk full'); });
    try {
      expect(() => store.set(OWNER, 'ws-2', manifest(OWNER, 'ws-2'))).toThrow('disk full');
    } finally {
      rename.mockRestore();
    }
    expect(store.has(OWNER, 'ws-2')).toBe(false);
    expect(fs.readFileSync(file(), 'utf8')).toBe(before);
    expect(fs.readdirSync(dir)).toEqual([STATE_FILE]);
  });

  test('without a directory it keeps manifests in memory only', () => {
    const store = new ManifestStore({ logger });
    store.set(OWNER, 'ws-1', manifest());
    expect(store.get(OWNER, 'ws-1')).not.toBeNull();
    expect(store.file).toBeNull();
  });
});

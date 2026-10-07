const {
  parseObjectReference, normalizeObjectReference, serializeObjectReference,
} = require('../lib/object-reference');
const { listProfiles, getProfile } = require('../lib/profiles');
const { limitsFromEnvironment, validateWorkspaceRequest } = require('../lib/workspace-spec');
const { ConfigEnvironmentResolver, builtInCandidates, loadCandidates } = require('../lib/environment-resolver');
const { createManifest, serializeManifest, deserializeManifest, validateManifest } = require('../lib/manifest');
const { workspaceRequestFromRun } = require('../lib/run-resolver');

const identity = { user_id: 'user-1', organization_id: 'org-1' };
const now = () => new Date('2026-10-01T12:00:00.000Z');

function request(overrides = {}) {
  return {
    workspace: { profile: 'generic-python', name: 'Research workspace' },
    ide: { type: 'jupyterlab' },
    resources: { cpu: 2, memory_bytes: 4 * 1024 ** 3, gpu: 0, architecture: 'amd64' },
    objects: [],
    ...overrides,
  };
}

describe('OmniBioAI object references', () => {
  test.each(['dataset', 'workflow', 'model', 'run', 'tool'])('parses and serializes %s references', (type) => {
    const parsed = parseObjectReference(`omnibioai://${type}/abc-123_v2`);
    expect(parsed).toEqual({ type, id: 'abc-123_v2', uri: `omnibioai://${type}/abc-123_v2` });
    expect(serializeObjectReference(parsed)).toBe(`omnibioai://${type}/abc-123_v2`);
  });

  test.each([
    '', 'http://dataset/id', 'omnibioai://sample/id', 'omnibioai://dataset/',
    'omnibioai://dataset/../../etc', 'omnibioai://dataset/id?admin=true', 'omnibioai://run/id/extra',
  ])('rejects malformed reference %p', (value) => {
    expect(() => parseObjectReference(value)).toThrow();
  });

  test('normalizes structured references and rejects extra fields', () => {
    expect(normalizeObjectReference({ type: 'tool', id: 'tool.1' }).uri).toBe('omnibioai://tool/tool.1');
    expect(() => normalizeObjectReference({ type: 'tool', id: 'tool.1', authorized: true })).toThrow(/unsupported/);
  });
});

describe('workspace profiles and specification', () => {
  test('exposes seven declarative profiles without image guesses', () => {
    const profiles = listProfiles();
    expect(profiles).toHaveLength(7);
    expect(profiles.map((profile) => profile.name)).toEqual(expect.arrayContaining([
      'Generic Python', 'Generic R', 'RNA-seq', 'Single-cell', 'Variant analysis', 'Proteomics', 'ML/AI development',
    ]));
    expect(JSON.stringify(profiles)).not.toMatch(/ghcr\.io/);
    expect(getProfile('generic-r').preferred_ide).toBe('rstudio');
  });

  test('derives identity and provenance exclusively from server context', () => {
    const spec = validateWorkspaceRequest(request(), { identity, now, launcherVersion: '0.1.0' });
    expect(spec.identity).toEqual(identity);
    expect(spec.provenance).toEqual({ created_at: '2026-10-01T12:00:00.000Z', launcher_version: '0.1.0' });
  });

  test.each([
    [{ identity: { user_id: 'attacker', organization_id: 'other' } }, /unsupported fields/],
    [{ privileged: true }, /unsupported fields/],
    [{ mounts: ['/etc:/host'] }, /unsupported fields/],
    [{ docker_args: ['--device=/dev/sda'] }, /unsupported fields/],
  ])('rejects client-controlled identity or Docker injection fields', (extra, error) => {
    expect(() => validateWorkspaceRequest({ ...request(), ...extra }, { identity })).toThrow(error);
  });

  test.each(['lab', 'jupyter', '', 'JUPYTERLAB'])('rejects invalid environment %p', (type) => {
    expect(() => validateWorkspaceRequest(request({ ide: { type } }), { identity })).toThrow(/IDE/);
  });

  test.each(['x86_64', 'aarch64', 's390x', '../amd64'])('rejects unsupported architecture %p', (architecture) => {
    expect(() => validateWorkspaceRequest(request({ resources: { cpu: 1, memory_bytes: 512 * 1024 ** 2, gpu: 0, architecture } }), { identity })).toThrow(/architecture/);
  });

  test.each([
    { cpu: 0, memory_bytes: 1024, gpu: 0, architecture: 'amd64' },
    { cpu: 17, memory_bytes: 1024, gpu: 0, architecture: 'amd64' },
    { cpu: 1, memory_bytes: 0, gpu: 0, architecture: 'amd64' },
    { cpu: 1, memory_bytes: 1024, gpu: -1, architecture: 'amd64' },
    { cpu: 1, memory_bytes: 1024, gpu: 1.5, architecture: 'amd64' },
  ])('rejects invalid resource request %#', (resources) => {
    expect(() => validateWorkspaceRequest(request({ resources }), { identity })).toThrow();
  });

  test('uses configurable resource limits safely', () => {
    const limits = limitsFromEnvironment({ WORKSPACE_MAX_CPU: '4', WORKSPACE_MAX_MEMORY_BYTES: String(512 * 1024 ** 2), WORKSPACE_MAX_GPU: '1' });
    expect(limits).toEqual({ cpu: 4, memory_bytes: 512 * 1024 ** 2, gpu: 1 });
    expect(() => validateWorkspaceRequest(request({ resources: { cpu: 5, memory_bytes: 512 * 1024 ** 2, gpu: 0, architecture: 'amd64' } }), { identity, limits })).toThrow();
  });

  test.each(['docker.io/library/python:3.12;--privileged', 'https://registry.example.test/org/image', '../image', 'image name', 'repo/image@sha256:nope'])('rejects unsafe image %p', (reference) => {
    expect(() => validateWorkspaceRequest(request({ image: { reference } }), { identity })).toThrow(/image/);
  });
});

describe('environment resolution', () => {
  test('resolves a deterministic compatible local candidate', () => {
    const spec = validateWorkspaceRequest(request(), { identity });
    const candidate = new ConfigEnvironmentResolver([{
      id: 'python-a', ide: 'jupyterlab', container: 'omnibioai-jupyter', architectures: ['amd64'],
      capabilities: ['python'], gpu_available: 0, environment: { channel: 'stable' },
    }]).resolve(spec);
    expect(candidate.id).toBe('python-a');
  });

  test('fails closed for missing capabilities, architecture, image, or GPU', () => {
    const candidate = {
      id: 'python-a', ide: 'jupyterlab', container: 'omnibioai-jupyter', architectures: ['arm64'],
      capabilities: ['python'], gpu_available: 0, image_reference: 'registry.example.test/verified:1', environment: {},
    };
    const resolver = new ConfigEnvironmentResolver([candidate]);
    expect(() => resolver.resolve(validateWorkspaceRequest(request(), { identity }))).toThrow(/no compatible/);
    expect(() => resolver.resolve(validateWorkspaceRequest(request({ resources: { cpu: 1, memory_bytes: 512 * 1024 ** 2, gpu: 1, architecture: 'arm64' } }), { identity }))).toThrow(/no compatible/);
    expect(() => resolver.resolve(validateWorkspaceRequest(request({ workspace: { profile: 'rna-seq' }, resources: { cpu: 1, memory_bytes: 512 * 1024 ** 2, gpu: 0, architecture: 'arm64' } }), { identity }))).toThrow(/no compatible/);
  });

  test('resolves Terminal through the fixed VS Code workspace container', () => {
    const spec = validateWorkspaceRequest(request({
      ide: { type: 'terminal' },
      resources: { ...request().resources, architecture: process.arch === 'arm64' ? 'arm64' : 'amd64' },
    }), { identity });
    const candidate = new ConfigEnvironmentResolver().resolve(spec);
    expect(candidate.ide).toBe('terminal');
    expect(candidate.container).toBe('omnibioai-vscode');
  });

  test('rejects arbitrary configured containers and invalid configuration JSON', () => {
    expect(() => new ConfigEnvironmentResolver([{
      id: 'evil', ide: 'jupyterlab', container: 'host-root', architectures: ['amd64'], capabilities: ['python'], gpu_available: 0,
    }])).toThrow(/unsupported container/);
    expect(() => loadCandidates({ LAUNCHER_ENVIRONMENTS_JSON: '{' })).toThrow(/valid JSON/);
    expect(builtInCandidates()).toHaveLength(4);
  });
});

describe('workspace manifests', () => {
  function manifest() {
    const spec = validateWorkspaceRequest(request({ objects: ['omnibioai://dataset/data-1'] }), { identity, now, launcherVersion: '0.1.0' });
    return createManifest({
      spec, workspaceId: 'workspace-1',
      environment: { id: 'python-a', environment: { channel: 'stable' } },
      image: { reference: 'registry.example.test/verified-runtime:1', digest: `sha256:${'a'.repeat(64)}` },
    });
  }

  test('strictly round-trips a versioned manifest', () => {
    const value = manifest();
    expect(deserializeManifest(serializeManifest(value))).toEqual(value);
    expect(value.objects[0].uri).toBe('omnibioai://dataset/data-1');
  });

  test.each(['token', 'password', 'api_key', 'Authorization', 'private-key'])('rejects secret-like manifest fields: %s', (key) => {
    const value = manifest();
    expect(() => validateManifest({ ...value, environment: { [key]: 'do-not-store' } })).toThrow(/secret|unsafe/);
  });

  test('rejects unknown fields and malformed serialized data', () => {
    expect(() => validateManifest({ ...manifest(), extra: true })).toThrow(/unsupported/);
    expect(() => deserializeManifest('{bad')).toThrow(/valid JSON/);
  });
});

describe('Run to Debug boundary', () => {
  test('requires a run URI, authorization, and a configured metadata resolver', async () => {
    await expect(workspaceRequestFromRun('omnibioai://dataset/x', {})).rejects.toMatchObject({ status: 400 });
    await expect(workspaceRequestFromRun('omnibioai://run/x', {})).rejects.toMatchObject({ status: 501 });
    await expect(workspaceRequestFromRun('omnibioai://run/x', { authorize: async () => false })).rejects.toMatchObject({ status: 403 });
    await expect(workspaceRequestFromRun('omnibioai://run/x', { authorize: async () => true })).rejects.toMatchObject({ status: 501 });
  });

  test('passes only an authorized canonical reference to an injected resolver', async () => {
    const resolve = jest.fn(async (reference) => ({ workspace: { name: reference.id } }));
    await expect(workspaceRequestFromRun('omnibioai://run/run-7', { authorize: async () => true, resolver: { resolve } })).resolves.toEqual({ workspace: { name: 'run-7' } });
    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ type: 'run', id: 'run-7' }));
  });
});

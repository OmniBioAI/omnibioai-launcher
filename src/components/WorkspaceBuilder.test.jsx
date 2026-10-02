import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WorkspaceBuilder from './WorkspaceBuilder';

const GiB = 1024 ** 3;
const PROFILES = [
  { id: 'generic-python', name: 'Generic Python', preferred_ide: 'jupyterlab', resources: { cpu: 2, memory_bytes: 4 * GiB, gpu: 0 }, required_capabilities: ['python'], environment: { language: 'python' } },
  { id: 'generic-r', name: 'Generic R', preferred_ide: 'rstudio', resources: { cpu: 2, memory_bytes: 4 * GiB, gpu: 0 }, required_capabilities: ['r'], environment: { language: 'r' } },
  { id: 'rna-seq', name: 'RNA-seq', preferred_ide: 'jupyterlab', resources: { cpu: 4, memory_bytes: 16 * GiB, gpu: 0 }, required_capabilities: ['python', 'rna-seq'], environment: { domain: 'transcriptomics' } },
  { id: 'single-cell', name: 'Single-cell', preferred_ide: 'jupyterlab', resources: { cpu: 4, memory_bytes: 16 * GiB, gpu: 0 }, required_capabilities: ['python', 'single-cell'], environment: { domain: 'single-cell' } },
  { id: 'variant-analysis', name: 'Variant analysis', preferred_ide: 'jupyterlab', resources: { cpu: 4, memory_bytes: 16 * GiB, gpu: 0 }, required_capabilities: ['python', 'variant-analysis'], environment: { domain: 'genomics' } },
  { id: 'proteomics', name: 'Proteomics', preferred_ide: 'jupyterlab', resources: { cpu: 4, memory_bytes: 16 * GiB, gpu: 0 }, required_capabilities: ['python', 'proteomics'], environment: { domain: 'proteomics' } },
  { id: 'ml-ai-development', name: 'ML/AI development', preferred_ide: 'vscode', resources: { cpu: 4, memory_bytes: 16 * GiB, gpu: 0 }, gpu_preference: true, required_capabilities: ['python', 'ml'], environment: { domain: 'machine-learning' } },
];
const LIMITS = { cpu: 16, memory_bytes: 64 * GiB, gpu: 2 };

function jsonResponse(body, status = 200) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
}

function validationPayload(overrides = {}) {
  return {
    specification: {
      workspace: { profile: 'generic-python' }, ide: { type: 'jupyterlab' },
      resources: { cpu: 2, memory_bytes: 4 * GiB, gpu: 0, architecture: 'amd64' }, objects: [],
    },
    environment: { id: 'local-jupyterlab', ide: 'jupyterlab', architectures: ['amd64'], capabilities: ['python'], gpu_available: 0 },
    ...overrides,
  };
}

function installFetch({ validate, launch, debug, profiles = { profiles: PROFILES, resource_limits: LIMITS } } = {}) {
  global.fetch = jest.fn((url, init = {}) => {
    if (url.endsWith('/api/launcher/v1/profiles')) return jsonResponse(profiles);
    if (url.includes('/api/launcher/status/')) return jsonResponse({ status: url.endsWith('/jupyter') ? 'running' : 'stopped' });
    if (url.endsWith('/api/launcher/v1/workspaces/validate')) return validate ? validate(url, init) : jsonResponse(validationPayload());
    if (url.endsWith('/api/launcher/v1/workspaces/from-run')) return debug ? debug(url, init) : jsonResponse({ error: 'run metadata integration is not configured' }, 501);
    if (/\/api\/launcher\/v1\/workspaces\/[^/]+\/manifest$/.test(url)) return jsonResponse({ schema_version: '1.0', workspace_id: 'workspace-1' });
    if (url.endsWith('/api/launcher/v1/workspaces')) return launch ? launch(url, init) : jsonResponse({ error: 'launch not configured in test' }, 500);
    return Promise.reject(new Error(`Unexpected request: ${url}`));
  });
}

async function renderLoaded(props = {}) {
  const onOpenIde = jest.fn();
  const onBrowseObjects = jest.fn();
  render(<WorkspaceBuilder baseUrl="" onOpenIde={onOpenIde} onBrowseObjects={onBrowseObjects} {...props} />);
  await screen.findByRole('button', { name: /Generic Python/i });
  return { onOpenIde, onBrowseObjects };
}

describe('WorkspaceBuilder', () => {
  afterEach(() => jest.restoreAllMocks());

  test('loads all profiles from the backend and applies profile selection metadata', async () => {
    installFetch();
    await renderLoaded();
    expect(screen.getAllByText(/Generic Python|Generic R|RNA-seq|Single-cell|Variant analysis|Proteomics|ML\/AI development/)).toHaveLength(8);
    await userEvent.click(screen.getByRole('button', { name: /Generic R/i }));
    expect(screen.getByRole('button', { name: /Generic R/i })).toHaveAttribute('aria-pressed', 'true');
    const ideSection = screen.getByRole('region', { name: 'Select IDE' });
    expect(within(ideSection).getByText('RStudio').closest('button')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Workspace review')).toHaveTextContent('Generic R');
  });

  test('shows profile API failures without inventing fallback profile data', async () => {
    installFetch({ profiles: { error: 'authentication required' } });
    global.fetch.mockImplementation((url) => url.endsWith('/profiles')
      ? jsonResponse({ error: 'authentication required' }, 401)
      : jsonResponse({ status: 'stopped' }));
    render(<WorkspaceBuilder baseUrl="" onOpenIde={jest.fn()} onBrowseObjects={jest.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('authentication required');
    expect(screen.queryByRole('button', { name: /Generic Python/i })).not.toBeInTheDocument();
  });

  test('selects IDEs and preserves open behavior for a running legacy service', async () => {
    installFetch();
    const { onOpenIde } = await renderLoaded();
    await userEvent.click(screen.getByRole('button', { name: /VS Code Browser-based/i }));
    expect(screen.getByRole('button', { name: /VS Code Browser-based/i })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(await screen.findByRole('button', { name: 'Open ↗' }));
    expect(onOpenIde).toHaveBeenCalledWith('jupyterlab');
  });

  test('validates object references, attaches canonical context, and removes it', async () => {
    installFetch();
    await renderLoaded();
    const input = screen.getByLabelText('OmniBioAI object reference');
    await userEvent.type(input, 'omnibioai://dataset/../../etc');
    await userEvent.click(screen.getByRole('button', { name: 'Attach' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Use omnibioai://');
    await userEvent.clear(input);
    await userEvent.type(input, 'omnibioai://dataset/data-17');
    await userEvent.click(screen.getByRole('button', { name: 'Attach' }));
    expect(screen.getByLabelText('Attached objects')).toHaveTextContent('data-17');
    expect(screen.getByLabelText('Workspace review')).toHaveTextContent('omnibioai://dataset/data-17');
    await userEvent.click(screen.getByRole('button', { name: 'Remove omnibioai://dataset/data-17' }));
    expect(screen.queryByLabelText('Attached objects')).not.toBeInTheDocument();
  });

  test('updates CPU, memory, GPU, and architecture in the workspace preview', async () => {
    installFetch();
    await renderLoaded();
    fireEvent.change(screen.getByRole('slider', { name: 'CPU' }), { target: { value: '6' } });
    fireEvent.change(screen.getByRole('slider', { name: 'Memory' }), { target: { value: String(8 * GiB) } });
    fireEvent.change(screen.getByRole('slider', { name: 'GPU' }), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('Architecture'), { target: { value: 'arm64' } });
    const review = screen.getByLabelText('Workspace review');
    expect(review).toHaveTextContent('6');
    expect(review).toHaveTextContent('8 GiB');
    expect(review).toHaveTextContent('1 requested');
    expect(review).toHaveTextContent('arm64');
  });

  test('validates through the v1 API and renders the resolved environment', async () => {
    const validate = jest.fn(() => jsonResponse(validationPayload()));
    installFetch({ validate });
    await renderLoaded();
    await userEvent.click(screen.getByRole('button', { name: 'Validate configuration' }));
    expect(await screen.findByText('Validated')).toBeInTheDocument();
    expect(screen.getByText('local-jupyterlab')).toBeInTheDocument();
    const body = JSON.parse(validate.mock.calls[0][1].body);
    expect(body).toMatchObject({ workspace: { profile: 'generic-python' }, ide: { type: 'jupyterlab' }, resources: { cpu: 2, gpu: 0 } });
    expect(body.resources).not.toHaveProperty('architecture');
  });

  test('requires successful validation to launch and invalidates it on every configuration change', async () => {
    installFetch();
    await renderLoaded();
    const launch = screen.getByRole('button', { name: 'Launch Workspace' });
    expect(launch).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Validate configuration' }));
    expect(await screen.findByText('Validated')).toBeInTheDocument();
    expect(launch).toBeEnabled();
    fireEvent.change(screen.getByRole('slider', { name: 'CPU' }), { target: { value: '3' } });
    expect(screen.getByText('Not validated')).toBeInTheDocument();
    expect(launch).toBeDisabled();
  });

  test('shows actionable validation failures and does not attempt launch', async () => {
    const validate = jest.fn(() => jsonResponse({ error: 'no compatible configured environment was found' }, 422));
    const launch = jest.fn();
    installFetch({ validate, launch });
    await renderLoaded();
    await userEvent.click(screen.getByRole('button', { name: 'Validate configuration' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no compatible configured environment');
    expect(screen.getByText('Validation failed')).toBeInTheDocument();
    expect(launch).not.toHaveBeenCalled();
  });

  test('prevents duplicate launch submissions and shows progress', async () => {
    let resolveValidation;
    const validate = jest.fn(() => new Promise((resolve) => { resolveValidation = resolve; }));
    const launch = jest.fn(() => jsonResponse({ error: 'stop here' }, 500));
    installFetch({ validate, launch });
    await renderLoaded();
    await userEvent.click(screen.getByRole('button', { name: 'Validate configuration' }));
    expect(screen.getByText('Validating')).toBeInTheDocument();
    await act(async () => resolveValidation(await jsonResponse(validationPayload())));
    expect(screen.getByText('Validated')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Launch Workspace' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(screen.getByRole('button', { name: 'Launching workspace…' })).toBeDisabled();
    expect(validate).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('alert')).toHaveTextContent('stop here');
    expect(launch).toHaveBeenCalledTimes(1);
  });

  test('reports backend launch failures without claiming success', async () => {
    installFetch({ launch: () => jsonResponse({ error: 'workspace image architecture is incompatible with the request' }, 422) });
    await renderLoaded();
    await userEvent.click(screen.getByRole('button', { name: 'Validate configuration' }));
    expect(await screen.findByText('Validated')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Launch Workspace' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('architecture is incompatible');
    expect(screen.queryByText(/is running/)).not.toBeInTheDocument();
  });

  test('renders a successful safe manifest and never displays secret-like response fields', async () => {
    const manifest = {
      schema_version: '1.0', workspace_id: 'workspace-1', profile: 'generic-python', ide: 'jupyterlab',
      image: { reference: 'registry.example.test/runtime:1', digest: `sha256:${'a'.repeat(64)}` },
      resources: { cpu: 2, memory_bytes: 4 * GiB, gpu: 0, architecture: 'amd64' }, objects: [],
      identity: { user_id: 'user-1', organization_id: 'org-1' }, created_at: '2026-10-01T12:00:00.000Z',
      launcher_version: '0.1.0', environment: { channel: 'stable', api_key: 'SHOULD_NOT_RENDER' }, provenance: { resolver: 'local-config-v1' },
    };
    global.fetch = jest.fn((url, init = {}) => {
      if (url.endsWith('/api/launcher/v1/profiles')) return jsonResponse({ profiles: PROFILES, resource_limits: LIMITS });
      if (url.includes('/api/launcher/status/')) return jsonResponse({ status: 'stopped' });
      if (url.endsWith('/api/launcher/v1/workspaces/validate')) return jsonResponse(validationPayload());
      if (url.endsWith('/api/launcher/v1/workspaces')) return jsonResponse({ workspace_id: 'workspace-1', status: 'started', manifest }, 201);
      if (url.endsWith('/workspace-1/manifest')) return jsonResponse(manifest);
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });
    await renderLoaded();
    await userEvent.click(screen.getByRole('button', { name: 'Validate configuration' }));
    expect(await screen.findByText('Validated')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Launch Workspace' }));
    expect(await screen.findByText('Workspace workspace-1 is running.')).toBeInTheDocument();
    const manifestDetails = screen.getByText('Workspace Manifest').closest('details');
    expect(manifestDetails).not.toHaveAttribute('open');
    await userEvent.click(screen.getByText('Workspace Manifest'));
    expect(screen.getByText(/schema_version/)).toBeInTheDocument();
    expect(screen.queryByText(/SHOULD_NOT_RENDER/)).not.toBeInTheDocument();
    expect(screen.queryByText(/api_key/)).not.toBeInTheDocument();
  });

  test('handles Debug-from-Run malformed input and unavailable 501 integration truthfully', async () => {
    const debug = jest.fn(() => jsonResponse({ error: 'run authorization integration is not configured' }, 501));
    installFetch({ debug });
    await renderLoaded();
    const input = screen.getByLabelText('Run reference');
    await userEvent.type(input, 'omnibioai://dataset/not-a-run');
    await userEvent.click(screen.getByRole('button', { name: 'Debug from Run' }));
    expect(screen.getByText(/valid omnibioai:\/\/run/)).toBeInTheDocument();
    expect(debug).not.toHaveBeenCalled();
    await userEvent.clear(input);
    await userEvent.type(input, 'omnibioai://run/run-42');
    await userEvent.click(screen.getByRole('button', { name: 'Debug from Run' }));
    expect(await screen.findByText(/not available in this deployment/)).toBeInTheDocument();
  });

  test('navigates to the existing object registry', async () => {
    installFetch();
    const { onBrowseObjects } = await renderLoaded();
    await userEvent.click(screen.getByRole('button', { name: 'Browse object registry' }));
    expect(onBrowseObjects).toHaveBeenCalledTimes(1);
  });
});

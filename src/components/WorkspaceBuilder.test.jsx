import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

function installFetch({ validate, launch, debug, profiles = { profiles: PROFILES, resource_limits: LIMITS }, running = ['jupyter'] } = {}) {
  global.fetch = jest.fn((url, init = {}) => {
    if (url.endsWith('/api/launcher/v1/profiles')) return jsonResponse(profiles);
    if (url.includes('/api/launcher/status/')) return jsonResponse({ status: running.includes(url.split('/').pop()) ? 'running' : 'stopped' });
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
  await screen.findByRole('radio', { name: /^Generic Python/i });
  return { onOpenIde, onBrowseObjects };
}

describe('WorkspaceBuilder', () => {
  afterEach(() => jest.restoreAllMocks());

  test('loads all profiles from the backend and applies profile selection metadata', async () => {
    installFetch();
    await renderLoaded();
    expect(screen.getAllByText(/Generic Python|Generic R|RNA-seq|Single-cell|Variant analysis|Proteomics|ML\/AI development/)).toHaveLength(8);
    await userEvent.click(screen.getByRole('radio', { name: /Generic R/i }));
    expect(screen.getByRole('radio', { name: /Generic R/i })).toHaveAttribute('aria-checked', 'true');
    const ideSection = screen.getByRole('region', { name: 'Select Environment' });
    expect(within(ideSection).getByRole('radio', { name: /RStudio/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('Workspace review')).toHaveTextContent('Generic R');
  });

  test('shows profile API failures without inventing fallback profile data', async () => {
    installFetch({ profiles: { error: 'authentication required' } });
    global.fetch.mockImplementation((url) => url.endsWith('/profiles')
      ? jsonResponse({ error: 'authentication required' }, 401)
      : jsonResponse({ status: 'stopped' }));
    render(<WorkspaceBuilder baseUrl="" onOpenIde={jest.fn()} onBrowseObjects={jest.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('authentication required');
    expect(screen.queryByRole('radio', { name: /Generic Python/i })).not.toBeInTheDocument();
  });

  test('lists each environment once, with no separate Running services section', async () => {
    installFetch();
    await renderLoaded();
    expect(screen.queryByRole('region', { name: 'Running services' })).not.toBeInTheDocument();
    const environments = screen.getByRole('region', { name: 'Select Environment' });
    for (const label of ['JupyterLab', 'RStudio', 'VS Code', 'Terminal']) {
      expect(within(environments).getAllByText(label, { selector: 'strong' })).toHaveLength(1);
    }
    expect(within(environments).getAllByRole('radio')).toHaveLength(4);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Workspace Launcher');
  });

  test('shows an Open button only for running environments', async () => {
    installFetch({ running: ['jupyter', 'vscode'] });
    await renderLoaded();
    const environments = screen.getByRole('region', { name: 'Select Environment' });
    expect(await within(environments).findByRole('button', { name: 'Open JupyterLab ↗' })).toBeInTheDocument();
    expect(within(environments).getByRole('button', { name: 'Open VS Code ↗' })).toBeInTheDocument();
    expect(within(environments).getByRole('button', { name: 'Open Terminal ↗' })).toBeInTheDocument();
    expect(within(environments).queryByRole('button', { name: 'Open RStudio ↗' })).not.toBeInTheDocument();
    expect(within(environments).getAllByRole('button', { name: /^Open / })).toHaveLength(3);
  });

  test('Open calls onOpenIde without changing the selected environment', async () => {
    installFetch({ running: ['jupyter', 'vscode'] });
    const { onOpenIde } = await renderLoaded();
    const environments = screen.getByRole('region', { name: 'Select Environment' });
    const jupyter = within(environments).getByRole('radio', { name: /JupyterLab/ });
    expect(jupyter).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(await within(environments).findByRole('button', { name: 'Open VS Code ↗' }));
    expect(onOpenIde).toHaveBeenCalledWith('vscode');
    expect(jupyter).toHaveAttribute('aria-checked', 'true');
    expect(within(environments).getByRole('radio', { name: /VS Code/ })).toHaveAttribute('aria-checked', 'false');
  });

  test('no interactive control is nested inside an environment radio', async () => {
    installFetch({ running: ['jupyter', 'rstudio', 'vscode'] });
    await renderLoaded();
    const environments = screen.getByRole('region', { name: 'Select Environment' });
    await within(environments).findByRole('button', { name: 'Open RStudio ↗' });
    for (const radio of within(environments).getAllByRole('radio')) {
      expect(radio.querySelector('button, a, input, select, textarea, [tabindex]')).toBeNull();
    }
  });

  test('VS Code and Terminal show the same status and say they share a container', async () => {
    let vscodeStatus = 'running';
    installFetch();
    global.fetch.mockImplementation((url) => {
      if (url.endsWith('/api/launcher/v1/profiles')) return jsonResponse({ profiles: PROFILES, resource_limits: LIMITS });
      if (url.endsWith('/status/terminal')) return Promise.reject(new Error('Terminal has no container of its own'));
      if (url.endsWith('/status/vscode')) return jsonResponse({ status: vscodeStatus });
      if (url.includes('/api/launcher/status/')) return jsonResponse({ status: 'stopped' });
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });
    jest.useFakeTimers();
    try {
      await renderLoaded();
      const badge = (id) => document.getElementById(`environment-status-${id}`);
      await act(async () => { await Promise.resolve(); });
      expect(badge('vscode')).toHaveTextContent('Running');
      expect(badge('terminal')).toHaveTextContent('Running');
      vscodeStatus = 'restarting';
      await act(async () => { jest.advanceTimersByTime(10000); });
      expect(badge('vscode')).toHaveTextContent('Starting');
      expect(badge('terminal')).toHaveTextContent('Starting');
      expect(global.fetch).not.toHaveBeenCalledWith(expect.stringMatching(/\/status\/terminal$/), expect.anything());
    } finally { jest.useRealTimers(); }
    expect(screen.getByText('Shares the VS Code container')).toBeInTheDocument();
    expect(screen.getByText('Shared with Terminal')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Terminal/ })).toHaveAccessibleDescription('Starting');
  });

  test('renders Terminal alongside existing environments and includes it in the review', async () => {
    installFetch();
    await renderLoaded();
    const environmentSection = screen.getByRole('region', { name: 'Select Environment' });
    expect(within(environmentSection).getByText('JupyterLab', { selector: 'strong' })).toBeInTheDocument();
    expect(within(environmentSection).getByText('RStudio', { selector: 'strong' })).toBeInTheDocument();
    expect(within(environmentSection).getByText('VS Code', { selector: 'strong' })).toBeInTheDocument();
    const terminalButton = within(environmentSection).getByRole('radio', { name: /Terminal/ });
    await userEvent.click(terminalButton);
    expect(terminalButton).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('Workspace review')).toHaveTextContent('EnvironmentTerminal');
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
    fireEvent.change(screen.getByRole('slider', { name: 'Memory (GiB)' }), { target: { value: '8' } });
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
    const launchRequest = jest.fn(() => jsonResponse({ error: 'should not launch without validation' }, 500));
    installFetch({ launch: launchRequest, running: [] });
    await renderLoaded();
    const launch = screen.getByRole('button', { name: 'Launch Workspace' });
    expect(launch).toBeDisabled();
    fireEvent.click(launch);
    expect(launchRequest).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Validate configuration' }));
    expect(await screen.findByText('Validated')).toBeInTheDocument();
    expect(launch).toBeEnabled();
    expect(launchRequest).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('slider', { name: 'CPU' }), { target: { value: '3' } });
    expect(screen.getByText('Not validated')).toBeInTheDocument();
    expect(launch).toBeDisabled();
  });

  test('shows actionable validation failures and does not attempt launch', async () => {
    const validate = jest.fn(() => jsonResponse({ error: 'no compatible configured environment was found' }, 422));
    const launch = jest.fn();
    installFetch({ validate, launch, running: [] });
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
    installFetch({ validate, launch, running: [] });
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
    installFetch({ launch: () => jsonResponse({ error: 'workspace image architecture is incompatible with the request' }, 422), running: [] });
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

  test('hides Debug from Run unless the server reports the run integration is configured', async () => {
    installFetch();
    await renderLoaded();
    expect(screen.queryByRole('heading', { name: 'Debug from Run' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Run reference')).not.toBeInTheDocument();
    cleanup();

    installFetch({ profiles: { profiles: PROFILES, resource_limits: LIMITS, features: { debug_from_run: false } } });
    await renderLoaded();
    expect(screen.queryByLabelText('Run reference')).not.toBeInTheDocument();
    cleanup();

    installFetch({ profiles: { profiles: PROFILES, resource_limits: LIMITS, features: { debug_from_run: true } } });
    await renderLoaded();
    expect(screen.getByRole('heading', { name: 'Debug from Run' })).toBeInTheDocument();
  });

  test('handles Debug-from-Run malformed input and unavailable 501 integration truthfully', async () => {
    const debug = jest.fn(() => jsonResponse({ error: 'run authorization integration is not configured' }, 501));
    installFetch({ debug, profiles: { profiles: PROFILES, resource_limits: LIMITS, features: { debug_from_run: true } } });
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
    await userEvent.click(screen.getByRole('button', { name: 'Browse' }));
    expect(onBrowseObjects).toHaveBeenCalledTimes(1);
  });
});

describe('WorkspaceBuilder deployment compatibility', () => {
  afterEach(() => jest.restoreAllMocks());

  const WITH_COMPAT = PROFILES.map((profile) => ({
    ...profile,
    compatible_ides: {
      'generic-python': ['jupyterlab', 'vscode', 'terminal'],
      'generic-r': ['rstudio', 'vscode', 'terminal'],
      'rna-seq': ['jupyterlab', 'rstudio', 'vscode', 'terminal'],
      'single-cell': ['jupyterlab', 'rstudio', 'vscode', 'terminal'],
      'variant-analysis': ['jupyterlab', 'vscode', 'terminal'],
      proteomics: [],
      'ml-ai-development': [],
    }[profile.id],
  }));

  test('profiles no environment can satisfy are disabled and cannot be selected', async () => {
    installFetch({ profiles: { profiles: WITH_COMPAT, resource_limits: { ...LIMITS, gpu: 0 } } });
    await renderLoaded();
    const proteomics = screen.getByRole('radio', { name: /Proteomics/ });
    expect(proteomics).toHaveAttribute('aria-disabled', 'true');
    expect(proteomics).toHaveTextContent('Not available in this deployment');
    await userEvent.click(proteomics);
    expect(proteomics).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('radio', { name: /^Generic Python/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('GPU requests are disabled in this deployment.')).toBeInTheDocument();
  });

  test('environments incompatible with the profile are disabled', async () => {
    installFetch({ profiles: { profiles: WITH_COMPAT, resource_limits: LIMITS } });
    await renderLoaded();
    const ideSection = screen.getByRole('region', { name: 'Select Environment' });
    const rstudio = within(ideSection).getByRole('radio', { name: /RStudio/ });
    expect(rstudio).toHaveAttribute('aria-disabled', 'true');
    expect(rstudio).toHaveTextContent('Not compatible with Generic Python');
    await userEvent.click(rstudio);
    expect(rstudio).toHaveAttribute('aria-checked', 'false');
  });

  test('a running environment incompatible with the profile stays disabled but can still be opened', async () => {
    installFetch({ profiles: { profiles: WITH_COMPAT, resource_limits: LIMITS }, running: ['rstudio'] });
    const { onOpenIde } = await renderLoaded();
    const ideSection = screen.getByRole('region', { name: 'Select Environment' });
    const rstudio = within(ideSection).getByRole('radio', { name: /RStudio/ });
    expect(rstudio).toHaveAttribute('aria-disabled', 'true');
    const open = await within(ideSection).findByRole('button', { name: 'Open RStudio ↗' });
    expect(open).toBeEnabled();
    await userEvent.click(open);
    expect(onOpenIde).toHaveBeenCalledWith('rstudio');
    expect(rstudio).toHaveAttribute('aria-checked', 'false');
    expect(within(ideSection).getByRole('radio', { name: /JupyterLab/ })).toHaveAttribute('aria-checked', 'true');
  });

  test('exited containers show as Stopped, not Unavailable', async () => {
    installFetch();
    global.fetch.mockImplementation((url) => {
      if (url.endsWith('/api/launcher/v1/profiles')) return jsonResponse({ profiles: PROFILES, resource_limits: LIMITS });
      if (url.includes('/api/launcher/status/')) return jsonResponse({ status: 'exited' });
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });
    await renderLoaded();
    const environments = screen.getByRole('region', { name: 'Select Environment' });
    expect(await within(environments).findAllByText('Stopped')).toHaveLength(4);
    expect(within(environments).queryByText('Unavailable')).not.toBeInTheDocument();
    expect(within(environments).queryByRole('button', { name: /^Open / })).not.toBeInTheDocument();
  });

  test('a running selected service makes Open the primary action and keeps Launch disabled', async () => {
    installFetch();
    const { onOpenIde } = await renderLoaded();
    expect(await screen.findByText(/JupyterLab is already running/)).toHaveTextContent('stop it to launch with new resource settings');
    const panel = document.getElementById('launch-heading');
    const open = within(panel).getByRole('button', { name: 'Open JupyterLab ↗' });
    const validate = within(panel).getByRole('button', { name: 'Validate configuration' });
    const launch = within(panel).getByRole('button', { name: 'Launch Workspace' });
    expect(open).toHaveClass('button--primary');
    expect(validate).toHaveClass('button--secondary');
    expect(launch).not.toHaveClass('button--primary');
    expect(within(panel).getAllByRole('button').filter((button) => button.classList.contains('button--primary'))).toEqual([open]);
    expect(launch).toBeDisabled();
    await userEvent.click(validate);
    expect(await screen.findByText('Validated')).toBeInTheDocument();
    expect(launch).toBeDisabled();
    expect(launch).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(open);
    expect(onOpenIde).toHaveBeenCalledWith('jupyterlab');
  });

  test('a stopped selected service keeps Launch as the primary action', async () => {
    installFetch({ running: [] });
    await renderLoaded();
    const panel = document.getElementById('launch-heading');
    await act(async () => { await Promise.resolve(); });
    expect(within(panel).queryByRole('button', { name: /^Open / })).not.toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Launch Workspace' })).toHaveClass('button--primary');
    expect(within(panel).getByText('Validate the configuration to enable launch.')).toBeInTheDocument();
  });

  test('fractional GiB memory is sent as whole bytes and the label reflects customization', async () => {
    let body;
    installFetch({ validate: (url, init) => { body = JSON.parse(init.body); return jsonResponse(validationPayload()); } });
    await renderLoaded();
    expect(screen.getByText('Profile defaults applied')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Memory value in GiB'), { target: { value: '4.1' } });
    expect(screen.getByText('Customized')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Validate configuration' }));
    expect(Number.isInteger(body.resources.memory_bytes)).toBe(true);
    expect(body.resources.memory_bytes).toBe(Math.round(4.1 * GiB));
  });
});

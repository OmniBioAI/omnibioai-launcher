import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { authHeaders } from '../session';

const ENVIRONMENT_OPTIONS = [
  { id: 'jupyterlab', tool: 'jupyter', label: 'JupyterLab', description: 'Interactive notebooks and scientific exploration.', accent: '#f37726', icon: '◉' },
  { id: 'rstudio', tool: 'rstudio', label: 'RStudio', description: 'R and Bioconductor development environment.', accent: '#276dc3', icon: 'R' },
  { id: 'vscode', tool: 'vscode', label: 'VS Code', description: 'Browser-based editor for Python, R, and workflows.', accent: '#007acc', icon: '⌁' },
  { id: 'terminal', tool: 'terminal', label: 'Terminal', description: 'Shell access for CLI tools, scripts, and workflows.', accent: '#00e5a0', icon: '>_' },
];
const OBJECT_REFERENCE = /^omnibioai:\/\/(dataset|workflow|model|run|tool)\/([A-Za-z0-9][A-Za-z0-9._:-]{0,127})$/;
const SECRET_KEY = /(authorization|bearer|token|secret|password|passwd|credential|api[_-]?key|private[_-]?key|cookie)/i;

function parseError(payload, fallback) {
  return payload && typeof payload.error === 'string' ? payload.error : fallback;
}

async function responseJson(response) {
  return response.json().catch(() => ({}));
}

function safeForDisplay(value) {
  if (Array.isArray(value)) return value.map(safeForDisplay);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !SECRET_KEY.test(key))
    .map(([key, child]) => [key, safeForDisplay(child)]));
}

function ProfileCard({ profile, selected, onSelect }) {
  const resource = profile.resources || {};
  return (
    <button
      type="button"
      className={`profile-card${selected ? ' is-selected' : ''}`}
      aria-pressed={selected}
      onClick={() => onSelect(profile)}
    >
      <span className="selection-mark" aria-hidden="true">{selected ? '✓' : ''}</span>
      <strong>{profile.name}</strong>
      <span className="profile-ide">{profile.preferred_ide}</span>
      <span className="profile-resources">
        {resource.cpu} CPU · {formatMemory(resource.memory_bytes)}
        {profile.gpu_preference ? ' · GPU preferred, not guaranteed' : ''}
      </span>
    </button>
  );
}

function EnvironmentCard({ option, selected, status, onSelect, onOpen }) {
  const running = status === 'running';
  return (
    <div className={`ide-choice${selected ? ' is-selected' : ''}`} style={{ '--ide-accent': option.accent }}>
      <button type="button" className="ide-choice-main" aria-pressed={selected} onClick={() => onSelect(option.id)}>
        <span className="ide-choice-icon" aria-hidden="true">{option.icon}</span>
        <span className="ide-choice-copy">
          <strong>{option.label}</strong>
          <span>{option.description}</span>
        </span>
        <StatusBadge status={status} />
      </button>
      {running && <button type="button" className="ide-open-link" onClick={() => onOpen(option.id)}>Open ↗</button>}
    </div>
  );
}

function StatusBadge({ status = 'unknown' }) {
  const normalized = ['running', 'starting', 'stopped'].includes(status) ? status : 'unknown';
  const label = { running: 'Running', starting: 'Starting', stopped: 'Stopped', unknown: 'Unavailable' }[normalized];
  return <span className={`status-badge status-badge--${normalized}`}><span aria-hidden="true" />{label}</span>;
}

function formatMemory(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  const gib = bytes / 1024 ** 3;
  return `${Number.isInteger(gib) ? gib : gib.toFixed(2)} GiB`;
}

function profileResources(profile, limits) {
  const requested = profile?.resources || {};
  return {
    cpu: Math.min(requested.cpu ?? 2, limits?.cpu ?? Number.POSITIVE_INFINITY),
    memory_bytes: Math.min(requested.memory_bytes ?? 4 * 1024 ** 3, limits?.memory_bytes ?? Number.POSITIVE_INFINITY),
    gpu: Math.min(requested.gpu ?? 0, limits?.gpu ?? Number.POSITIVE_INFINITY),
  };
}

function ObjectReferenceEditor({ objects, onChange }) {
  const [input, setInput] = useState('');
  const [error, setError] = useState('');

  const add = () => {
    const value = input.trim();
    const match = OBJECT_REFERENCE.exec(value);
    if (!match) {
      setError('Use omnibioai://dataset|workflow|model|run|tool/<id>.');
      return;
    }
    if (objects.some((object) => object.uri === value)) {
      setError('That object reference is already attached.');
      return;
    }
    onChange([...objects, { type: match[1], id: match[2], uri: value }]);
    setInput('');
    setError('');
  };

  return (
    <div>
      <div className="object-input-row">
        <label className="sr-only" htmlFor="object-reference">OmniBioAI object reference</label>
        <input
          id="object-reference"
          value={input}
          onChange={(event) => { setInput(event.target.value); if (error) setError(''); }}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); add(); } }}
          placeholder="omnibioai://dataset/<id>"
          aria-describedby={`object-reference-help${error ? ' object-reference-error' : ''}`}
          aria-invalid={Boolean(error)}
        />
        <button type="button" className="button button--secondary" onClick={add}>Attach</button>
      </div>
      <p id="object-reference-help" className="field-help">References provide context only. Access is still checked by IAM and the owning service.</p>
      {error && <p id="object-reference-error" className="field-error" role="alert">{error}</p>}
      {objects.length > 0 && (
        <ul className="object-chip-list" aria-label="Attached objects">
          {objects.map((object) => (
            <li key={object.uri} className="object-chip">
              <span className={`object-type object-type--${object.type}`}>{object.type}</span>
              <code title={object.uri}>{object.id}</code>
              <button type="button" aria-label={`Remove ${object.uri}`} onClick={() => onChange(objects.filter((item) => item.uri !== object.uri))}>×</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function WorkspacePreview({ profile, environment, resources, objects, validation, validationState, manifest, manifestError }) {
  const selectedEnvironment = ENVIRONMENT_OPTIONS.find((option) => option.id === environment);
  const effective = validation?.specification?.resources || resources;
  const displayedManifest = manifest ? safeForDisplay(manifest) : null;
  return (
    <aside className="workspace-preview" aria-label="Workspace review">
      <div className="panel-heading">
        <div><span className="eyebrow">Review workspace</span><h2>Launch summary</h2></div>
        <span className={`validation-pill ${validationState.toLowerCase().replaceAll(' ', '-')}`} role="status">{validationState}</span>
      </div>
      <dl className="review-list">
        <div><dt>Profile</dt><dd>{profile?.name || 'Select a profile'}</dd></div>
        <div><dt>Environment</dt><dd>{selectedEnvironment?.label || '—'}</dd></div>
        <div><dt>Architecture</dt><dd>{effective.architecture || 'Auto'}</dd></div>
        <div><dt>CPU</dt><dd>{effective.cpu ?? '—'}</dd></div>
        <div><dt>Memory</dt><dd>{formatMemory(effective.memory_bytes)}</dd></div>
        <div><dt>GPU</dt><dd>{effective.gpu ? `${effective.gpu} requested` : 'None'}</dd></div>
        <div><dt>Objects</dt><dd>{objects.length || 'None'}</dd></div>
      </dl>
      {validation?.environment && (
        <div className="resolved-environment">
          <span className="eyebrow">Resolved environment</span>
          <strong>{validation.environment.id}</strong>
          <span>{validation.environment.architectures?.join(', ')} · GPU capacity {validation.environment.gpu_available ?? 0}</span>
        </div>
      )}
      {objects.length > 0 && (
        <div className="review-objects">
          {objects.map((object) => <code key={object.uri}>{object.uri}</code>)}
        </div>
      )}
      <div className="security-note"><span aria-hidden="true">◇</span><p>Identity and authorization are derived server-side. Object references do not grant access.</p></div>
      {displayedManifest && (
        <details className="manifest-panel">
          <summary>Workspace Manifest</summary>
          <pre>{JSON.stringify(displayedManifest, null, 2)}</pre>
        </details>
      )}
      {manifestError && <p className="field-help" role="status">Workspace started, but its manifest could not be loaded: {manifestError}</p>}
    </aside>
  );
}

export default function WorkspaceBuilder({ baseUrl, onBrowseObjects, onOpenIde }) {
  const [profiles, setProfiles] = useState([]);
  const [limits, setLimits] = useState(null);
  const [profileId, setProfileId] = useState('');
  const [environment, setEnvironment] = useState('jupyterlab');
  const [resources, setResources] = useState({ cpu: 2, memory_bytes: 4 * 1024 ** 3, gpu: 0, architecture: '' });
  const [objects, setObjects] = useState([]);
  const [statuses, setStatuses] = useState({ jupyter: 'unknown', rstudio: 'unknown', vscode: 'unknown', terminal: 'unknown' });
  const [profilesError, setProfilesError] = useState('');
  const [validation, setValidation] = useState(null);
  const [validationFingerprint, setValidationFingerprint] = useState('');
  const [validationError, setValidationError] = useState('');
  const [validating, setValidating] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launchResult, setLaunchResult] = useState(null);
  const [launchError, setLaunchError] = useState('');
  const [manifestError, setManifestError] = useState('');
  const [runReference, setRunReference] = useState('');
  const [debugMessage, setDebugMessage] = useState('');
  const [debugging, setDebugging] = useState(false);
  const launchInFlight = useRef(false);
  const latestRequestFingerprint = useRef('');

  const selectedProfile = useMemo(() => profiles.find((profile) => profile.id === profileId), [profiles, profileId]);

  const markDirty = useCallback(() => {
    setValidation(null);
    setValidationFingerprint('');
    setValidationError('');
    setLaunchResult(null);
    setLaunchError('');
    setManifestError('');
  }, []);

  useEffect(() => {
    let active = true;
    fetch(`${baseUrl}/api/launcher/v1/profiles`, { headers: authHeaders() })
      .then(async (response) => {
        const payload = await responseJson(response);
        if (!response.ok) throw new Error(parseError(payload, `Unable to load profiles (${response.status}).`));
        return payload;
      })
      .then((payload) => {
        if (!active) return;
        const available = Array.isArray(payload.profiles) ? payload.profiles : [];
        setProfiles(available);
        setLimits(payload.resource_limits || null);
        if (available.length) {
          const initial = available.find((profile) => profile.id === 'generic-python') || available[0];
          setProfileId(initial.id);
          setEnvironment(initial.preferred_ide);
          setResources((current) => ({ ...current, ...profileResources(initial, payload.resource_limits), architecture: '' }));
        }
      })
      .catch((error) => { if (active) setProfilesError(error.message); });
    return () => { active = false; };
  }, [baseUrl]);

  const refreshStatuses = useCallback(async () => {
    const results = await Promise.all(ENVIRONMENT_OPTIONS.map(async (option) => {
      try {
        const response = await fetch(`${baseUrl}/api/launcher/status/${option.tool}`, { headers: authHeaders() });
        const payload = await responseJson(response);
        return [option.tool, response.ok ? payload.status || 'stopped' : 'unavailable'];
      } catch { return [option.tool, 'unavailable']; }
    }));
    setStatuses(Object.fromEntries(results));
  }, [baseUrl]);

  useEffect(() => {
    refreshStatuses();
    const timer = setInterval(refreshStatuses, 10000);
    return () => clearInterval(timer);
  }, [refreshStatuses]);

  const selectProfile = (profile) => {
    setProfileId(profile.id);
    setEnvironment(profile.preferred_ide);
    setResources((current) => ({ ...current, ...profileResources(profile, limits) }));
    markDirty();
  };

  const requestBody = useCallback(() => ({
    workspace: { profile: profileId, name: selectedProfile ? `${selectedProfile.name} workspace` : 'Scientific workspace' },
    ide: { type: environment },
    resources: {
      cpu: resources.cpu,
      memory_bytes: resources.memory_bytes,
      gpu: resources.gpu,
      ...(resources.architecture && { architecture: resources.architecture }),
    },
    objects: objects.map((object) => object.uri),
  }), [environment, objects, profileId, resources, selectedProfile]);

  const currentFingerprint = JSON.stringify(requestBody());
  latestRequestFingerprint.current = currentFingerprint;
  const isValidated = Boolean(validation && validationFingerprint === currentFingerprint);

  const validate = useCallback(async () => {
    if (!profileId) { setValidationError('Choose a workspace profile first.'); return null; }
    const body = requestBody();
    const fingerprint = JSON.stringify(body);
    setValidating(true);
    setValidationError('');
    try {
      const response = await fetch(`${baseUrl}/api/launcher/v1/workspaces/validate`, {
        method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body),
      });
      const payload = await responseJson(response);
      if (!response.ok) throw new Error(parseError(payload, `Validation failed (${response.status}).`));
      if (latestRequestFingerprint.current !== fingerprint) {
        setValidation(null);
        setValidationFingerprint('');
        setValidationError('Configuration changed during validation. Validate again.');
        return null;
      }
      setValidation(payload);
      setValidationFingerprint(fingerprint);
      return payload;
    } catch (error) {
      setValidation(null);
      setValidationFingerprint('');
      setValidationError(error.message);
      return null;
    } finally { setValidating(false); }
  }, [baseUrl, profileId, requestBody]);

  const launch = async () => {
    if (launchInFlight.current || !isValidated) return;
    launchInFlight.current = true;
    setLaunching(true);
    setLaunchError('');
    setLaunchResult(null);
    try {
      const response = await fetch(`${baseUrl}/api/launcher/v1/workspaces`, {
        method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(requestBody()),
      });
      const payload = await responseJson(response);
      if (!response.ok) throw new Error(parseError(payload, `Workspace launch failed (${response.status}).`));
      setLaunchResult(payload);
      setManifestError('');
      if (payload.workspace_id) {
        try {
          const manifestResponse = await fetch(`${baseUrl}/api/launcher/v1/workspaces/${encodeURIComponent(payload.workspace_id)}/manifest`, { headers: authHeaders() });
          const manifestPayload = await responseJson(manifestResponse);
          if (!manifestResponse.ok) throw new Error(parseError(manifestPayload, `Manifest request failed (${manifestResponse.status}).`));
          setLaunchResult((current) => current ? { ...current, manifest: manifestPayload } : current);
        } catch (error) { setManifestError(error.message); }
      }
      const tool = ENVIRONMENT_OPTIONS.find((option) => option.id === environment)?.tool;
      if (tool) setStatuses((current) => ({ ...current, [tool]: 'running' }));
    } catch (error) { setLaunchError(error.message); }
    finally { launchInFlight.current = false; setLaunching(false); }
  };

  const debugFromRun = async () => {
    setDebugMessage('');
    if (!/^omnibioai:\/\/run\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(runReference.trim())) {
      setDebugMessage('Enter a valid omnibioai://run/<id> reference.');
      return;
    }
    setDebugging(true);
    try {
      const response = await fetch(`${baseUrl}/api/launcher/v1/workspaces/from-run`, {
        method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ run_reference: runReference.trim() }),
      });
      const payload = await responseJson(response);
      if (response.status === 501) setDebugMessage('Run → Debug is not available in this deployment because the authoritative run integration is not configured.');
      else if (!response.ok) setDebugMessage(parseError(payload, `Unable to create a debug workspace (${response.status}).`));
      else setDebugMessage('Debug workspace request accepted.');
    } catch { setDebugMessage('Run → Debug could not reach the Launcher service.'); }
    finally { setDebugging(false); }
  };

  const resourceMax = limits || { cpu: 16, memory_bytes: 64 * 1024 ** 3, gpu: 8 };
  const selectedEnvironmentLabel = ENVIRONMENT_OPTIONS.find((option) => option.id === environment)?.label;
  const launchSucceeded = Boolean(launchResult?.manifest);
  const validationState = validating ? 'Validating' : validationError ? 'Validation failed' : isValidated ? 'Validated' : 'Not validated';

  return (
    <main id="main-content" className="workspace-shell">
      <header className="workspace-hero">
        <div className="brand-lockup"><span className="brand-mark">O</span><div><strong>OmniBioAI</strong><span>Workspace Launcher</span></div></div>
        <button type="button" className="button button--ghost" onClick={onBrowseObjects}>Browse object registry</button>
      </header>
      <section className="workspace-intro">
        <div><span className="eyebrow">Scientific workspace</span><h1>Configure an analysis environment</h1><p>Choose a profile, attach approved OmniBioAI context, and review the effective environment before launch.</p></div>
        <div className="workflow-steps" aria-label="Workspace workflow">
          {['Profile', 'Environment', 'Objects', 'Compute', 'Review', 'Launch'].map((step, index) => <span key={step}><b>{index + 1}</b>{step}</span>)}
        </div>
      </section>

      <div className="workspace-layout">
        <div className="workspace-config">
          <section className="config-panel" aria-labelledby="profile-heading">
            <div className="panel-heading"><div><span className="step-number">01</span><h2 id="profile-heading">Choose Workspace Profile</h2></div><span className="optional-label">Required</span></div>
            {profilesError && <div className="inline-message inline-message--error" role="alert">{profilesError}</div>}
            {!profiles.length && !profilesError && <div className="profile-skeleton" aria-label="Loading workspace profiles">Loading profiles…</div>}
            <div className="profile-grid">{profiles.map((profile) => <ProfileCard key={profile.id} profile={profile} selected={profile.id === profileId} onSelect={selectProfile} />)}</div>
          </section>

          <section className="config-panel" aria-labelledby="environment-heading">
            <div className="panel-heading"><div><span className="step-number">02</span><h2 id="environment-heading">Select Environment</h2></div><span className="optional-label">Existing workspace services</span></div>
            <div className="ide-grid">{ENVIRONMENT_OPTIONS.map((option) => <EnvironmentCard key={option.id} option={option} selected={environment === option.id} status={statuses[option.tool]} onSelect={(next) => { setEnvironment(next); markDirty(); }} onOpen={onOpenIde} />)}</div>
          </section>

          <section className="config-panel" aria-labelledby="objects-heading">
            <div className="panel-heading"><div><span className="step-number">03</span><h2 id="objects-heading">Attach OmniBioAI Objects</h2></div><span className="optional-label">Optional</span></div>
            <ObjectReferenceEditor objects={objects} onChange={(next) => { setObjects(next); markDirty(); }} />
          </section>

          <section className="config-panel" aria-labelledby="compute-heading">
            <div className="panel-heading"><div><span className="step-number">04</span><h2 id="compute-heading">Configure Compute</h2></div><span className="optional-label">Profile defaults applied</span></div>
            <div className="resource-grid">
              <label><span>CPU <output>{resources.cpu}</output></span><input aria-label="CPU" type="range" min="0.25" max={resourceMax.cpu} step="0.25" value={resources.cpu} onChange={(event) => { setResources({ ...resources, cpu: Number(event.target.value) }); markDirty(); }} /></label>
              <label><span>Memory <output>{formatMemory(resources.memory_bytes)}</output></span><input aria-label="Memory" type="range" min={256 * 1024 ** 2} max={resourceMax.memory_bytes} step={256 * 1024 ** 2} value={resources.memory_bytes} onChange={(event) => { setResources({ ...resources, memory_bytes: Number(event.target.value) }); markDirty(); }} /></label>
              <label><span>GPU <output>{resources.gpu}</output></span><input aria-label="GPU" type="range" min="0" max={resourceMax.gpu} step="1" value={resources.gpu} disabled={resourceMax.gpu === 0} onChange={(event) => { setResources({ ...resources, gpu: Number(event.target.value) }); markDirty(); }} /><small>{resourceMax.gpu === 0 ? 'GPU requests are disabled in this deployment.' : 'Requested only; availability is verified at launch.'}</small></label>
              <label><span>Architecture</span><select aria-label="Architecture" value={resources.architecture} onChange={(event) => { setResources({ ...resources, architecture: event.target.value }); markDirty(); }}><option value="">Auto</option><option value="amd64">amd64</option><option value="arm64">arm64</option></select></label>
            </div>
            <details className="advanced-details"><summary>Advanced resource details</summary><p>Server limits: up to {resourceMax.cpu} CPU, {formatMemory(resourceMax.memory_bytes)} memory, and {resourceMax.gpu} requested GPUs. Docker compatibility and actual GPU allocation are verified server-side.</p></details>
          </section>

          <section className="config-panel debug-panel" aria-labelledby="debug-heading">
            <div className="panel-heading"><div><span className="step-number">◇</span><h2 id="debug-heading">Debug from Run</h2></div><span className="optional-label">Deployment dependent</span></div>
            <div className="object-input-row"><label className="sr-only" htmlFor="run-reference">Run reference</label><input id="run-reference" value={runReference} onChange={(event) => setRunReference(event.target.value)} placeholder="omnibioai://run/<id>" /><button type="button" className="button button--secondary" disabled={debugging} onClick={debugFromRun}>{debugging ? 'Checking…' : 'Debug from Run'}</button></div>
            {debugMessage && <p className="field-help" role="status">{debugMessage}</p>}
          </section>
        </div>

        <div className="workspace-review-column">
          <WorkspacePreview profile={selectedProfile} environment={environment} resources={resources} objects={objects} validation={isValidated ? validation : null} validationState={validationState} manifest={launchResult?.manifest} manifestError={manifestError} />
          <div className="launch-panel">
            {validationError && <div className="inline-message inline-message--error" role="alert">{validationError}</div>}
            {launchError && <div className="inline-message inline-message--error" role="alert">{launchError}</div>}
            {launchSucceeded && <div className="inline-message inline-message--success" role="status">Workspace {launchResult.workspace_id} is running.</div>}
            <button type="button" className="button button--secondary button--wide" disabled={validating || launching || !profileId} onClick={validate}>{validating ? 'Validating…' : 'Validate configuration'}</button>
            <button type="button" className="button button--primary button--wide" disabled={!isValidated || launching || validating || !profileId} onClick={launch}>{launching ? 'Launching workspace…' : 'Launch Workspace'}</button>
            {launchSucceeded && <button type="button" className="button button--open button--wide" onClick={() => onOpenIde(environment)}>Open {ENVIRONMENT_OPTIONS.find((option) => option.id === environment)?.label} ↗</button>}
            <p>Launch uses the fixed shared <strong>{selectedEnvironmentLabel || 'environment'}</strong> service and requires infrastructure permission.</p>
          </div>
        </div>
      </div>
    </main>
  );
}

export { ENVIRONMENT_OPTIONS, OBJECT_REFERENCE, safeForDisplay };

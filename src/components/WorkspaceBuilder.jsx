import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { authHeaders } from '../session';

// Each environment is a shared container (omnibioai-jupyter, -rstudio,
// -vscode), not a per-user workspace. Terminal is VS Code Server's integrated
// terminal, so it reads the VS Code container's status rather than its own.
const ENVIRONMENT_OPTIONS = [
  { id: 'jupyterlab', container: 'jupyter', label: 'JupyterLab', description: 'Interactive notebooks and scientific exploration.', accent: '#f37726', icon: '◉' },
  { id: 'rstudio', container: 'rstudio', label: 'RStudio', description: 'R and Bioconductor development environment.', accent: '#276dc3', icon: 'R' },
  { id: 'vscode', container: 'vscode', label: 'VS Code', description: 'Browser-based editor for Python, R, and workflows.', accent: '#007acc', icon: '⌁', note: 'Shared with Terminal' },
  { id: 'terminal', container: 'vscode', label: 'Terminal', description: 'Shell access for CLI tools, scripts, and workflows.', accent: '#00e5a0', icon: '>_', note: 'Shares the VS Code container' },
];
const CONTAINERS = [...new Set(ENVIRONMENT_OPTIONS.map((option) => option.container))];
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

function selectWithKeyboard(event, values, current, onSelect) {
  const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
  if (!keys.includes(event.key)) return;
  event.preventDefault();
  const currentIndex = Math.max(0, values.indexOf(current));
  const nextIndex = event.key === 'Home' ? 0
    : event.key === 'End' ? values.length - 1
      : ['ArrowRight', 'ArrowDown'].includes(event.key) ? (currentIndex + 1) % values.length
        : (currentIndex - 1 + values.length) % values.length;
  onSelect(values[nextIndex]);
  // values may skip disabled cards, so focus by value rather than position.
  event.currentTarget.closest('[role="radiogroup"]')?.querySelector(`[role="radio"][data-value="${values[nextIndex]}"]`)?.focus();
}

// Older servers don't send compatible_ides; treat that as "unknown, allow all"
// so this UI keeps working against them.
function profileIsAvailable(profile) {
  return !Array.isArray(profile?.compatible_ides) || profile.compatible_ides.length > 0;
}

function ideIsCompatible(profile, ide) {
  return !Array.isArray(profile?.compatible_ides) || profile.compatible_ides.includes(ide);
}

function ProfileCard({ profile, selected, onSelect, profileIds }) {
  const resource = profile.resources || {};
  const available = profileIsAvailable(profile);
  return (
    <div
      role="radio"
      tabIndex={selected ? 0 : -1}
      className={`profile-card${selected ? ' is-selected' : ''}${available ? '' : ' is-unavailable'}`}
      data-value={profile.id}
      aria-checked={selected}
      aria-disabled={!available}
      onClick={() => { if (available) onSelect(profile); }}
      onKeyDown={(event) => selectWithKeyboard(event, profileIds, profile.id, (id) => onSelect({ ...profile, id }))}
    >
      <span className="selection-mark" aria-hidden="true">{selected ? '✓' : ''}</span>
      <strong>{profile.name}</strong>
      <span className="profile-ide">{profile.preferred_ide}</span>
      <span className="profile-resources">
        {resource.cpu} CPU · {formatMemory(resource.memory_bytes)}
        {profile.gpu_preference ? ' · GPU preferred, not guaranteed' : ''}
      </span>
      {!available && <span className="card-note">Not available in this deployment</span>}
    </div>
  );
}

// The radio holds only the selection; status and Open sit in a sibling row so
// no interactive control is nested inside role="radio", and opening a running
// container never changes the selection. Opening ignores profile
// compatibility: it is not a launch with the selected profile.
function EnvironmentCard({ option, selected, onSelect, environmentIds, compatible, profileName, status, onOpen }) {
  const running = normalizeStatus(status) === 'running';
  const statusId = `environment-status-${option.id}`;
  return (
    <div className={`ide-option${selected ? ' is-selected' : ''}`} style={{ '--ide-accent': option.accent }}>
      <div
        role="radio"
        tabIndex={selected ? 0 : -1}
        aria-checked={selected}
        aria-disabled={!compatible}
        aria-describedby={statusId}
        className={`ide-choice${selected ? ' is-selected' : ''}${compatible ? '' : ' is-unavailable'}`}
        data-value={option.id}
        onClick={() => { if (compatible) onSelect(option.id); }}
        onKeyDown={(event) => selectWithKeyboard(event, environmentIds, option.id, onSelect)}
      >
        <span className="selection-mark" aria-hidden="true">{selected ? '✓' : ''}</span>
        <span className="ide-choice-icon" aria-hidden="true">{option.icon}</span>
        <span className="ide-choice-copy">
          <strong>{option.label}</strong>
          <span>{option.description}</span>
          {!compatible && <span className="card-note">Not compatible with {profileName || 'this profile'}</span>}
        </span>
      </div>
      <div className="ide-option-actions">
        <StatusBadge id={statusId} status={status} />
        {option.note && <span className="ide-option-note">{option.note}</span>}
        {running && <button type="button" className="button button--open ide-option-open" onClick={() => onOpen(option.id)}>Open<span className="sr-only"> {option.label}</span> ↗</button>}
      </div>
    </div>
  );
}

// Docker reports container State.Status as created | running | paused |
// restarting | removing | exited | dead. Only the exact strings running,
// starting and stopped used to be recognised, so a stopped (exited) container
// was shown as "Unavailable" -- indistinguishable from a broken lookup.
const DOCKER_STATUS = Object.freeze({
  running: 'running', starting: 'starting', restarting: 'starting',
  stopped: 'stopped', exited: 'stopped', created: 'stopped', paused: 'stopped', dead: 'stopped',
});

function normalizeStatus(status) {
  return DOCKER_STATUS[status] || 'unknown';
}

function StatusBadge({ id, status = 'unknown' }) {
  const normalized = normalizeStatus(status);
  const label = { running: 'Running', starting: 'Starting', stopped: 'Stopped', unknown: 'Unavailable' }[normalized];
  return <span id={id} className={`status-badge status-badge--${normalized}`}><span aria-hidden="true" />{label}</span>;
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

// The profile's preferred IDE when it can satisfy the profile, otherwise the
// first IDE that can (e.g. a profile whose preferred IDE lacks its packages).
function environmentForProfile(profile) {
  if (ideIsCompatible(profile, profile?.preferred_ide)) return profile?.preferred_ide;
  return ENVIRONMENT_OPTIONS.find((option) => ideIsCompatible(profile, option.id))?.id || profile?.preferred_ide;
}

// Memory is sent in bytes and the API requires an integer; typed GiB values
// such as 4.1 produced 4402341478.4 bytes and a confusing 400 on validate.
function gibToBytes(value) {
  return Math.round(Number(value) * 1024 ** 3);
}

function ObjectReferenceEditor({ objects, onChange, onBrowseObjects, browseButtonRef }) {
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
          onChange={(event) => {
            const value = event.target.value;
            setInput(value);
            setError(value.trim() && !OBJECT_REFERENCE.test(value.trim()) ? 'Use omnibioai://<type>/<id> (dataset, workflow, model, run, or tool).' : '');
          }}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); add(); } }}
          placeholder="omnibioai://dataset/<id>"
          aria-describedby={`object-reference-help${error ? ' object-reference-error' : ''}`}
          aria-invalid={Boolean(error)}
        />
        <button ref={browseButtonRef} type="button" className="button button--secondary" onClick={onBrowseObjects}>Browse</button>
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

export default function WorkspaceBuilder({ baseUrl, onBrowseObjects, onOpenIde, pickedObject, browseButtonRef }) {
  const [profiles, setProfiles] = useState([]);
  const [limits, setLimits] = useState(null);
  const [profileId, setProfileId] = useState('');
  const [environment, setEnvironment] = useState('jupyterlab');
  const [resources, setResources] = useState({ cpu: 2, memory_bytes: 4 * 1024 ** 3, gpu: 0, architecture: '' });
  const [objects, setObjects] = useState([]);
  const [statuses, setStatuses] = useState(() => Object.fromEntries(CONTAINERS.map((container) => [container, 'unknown'])));
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
  // Hidden unless the server says its run resolver and authorizer are wired;
  // an older server without the flag also keeps it hidden.
  const [debugFromRunAvailable, setDebugFromRunAvailable] = useState(false);
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
    if (!pickedObject?.object_id) return;
    const sourceType = String(pickedObject.object_type || '').toLowerCase();
    const type = sourceType.includes('workflow') ? 'workflow'
      : sourceType.includes('model') ? 'model'
        : sourceType.includes('run') || sourceType.includes('job') ? 'run'
          : sourceType.includes('tool') ? 'tool' : 'dataset';
    const uri = `omnibioai://${type}/${pickedObject.object_id}`;
    setObjects((current) => current.some((item) => item.uri === uri) ? current : [...current, { type, id: pickedObject.object_id, uri }]);
    markDirty();
  }, [pickedObject, markDirty]);

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
        setDebugFromRunAvailable(payload.features?.debug_from_run === true);
        if (available.length) {
          const usable = available.filter(profileIsAvailable);
          const initial = usable.find((profile) => profile.id === 'generic-python') || usable[0] || available[0];
          setProfileId(initial.id);
          setEnvironment(environmentForProfile(initial));
          setResources((current) => ({ ...current, ...profileResources(initial, payload.resource_limits), architecture: '' }));
        }
      })
      .catch((error) => { if (active) setProfilesError(error.message); });
    return () => { active = false; };
  }, [baseUrl]);

  const refreshStatuses = useCallback(async () => {
    const results = await Promise.all(CONTAINERS.map(async (container) => {
      try {
        const response = await fetch(`${baseUrl}/api/launcher/status/${container}`, { headers: authHeaders() });
        const payload = await responseJson(response);
        return [container, response.ok ? payload.status || 'stopped' : 'unavailable'];
      } catch { return [container, 'unavailable']; }
    }));
    setStatuses(Object.fromEntries(results));
  }, [baseUrl]);

  useEffect(() => {
    refreshStatuses();
    const timer = setInterval(refreshStatuses, 10000);
    return () => clearInterval(timer);
  }, [refreshStatuses]);

  const selectProfile = (profile) => {
    if (!profileIsAvailable(profile)) return;
    setProfileId(profile.id);
    setEnvironment(environmentForProfile(profile));
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
      const container = ENVIRONMENT_OPTIONS.find((option) => option.id === environment)?.container;
      if (container) setStatuses((current) => ({ ...current, [container]: 'running' }));
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

  const launchSucceeded = Boolean(launchResult?.manifest);
  const resourceMax = limits || { cpu: 16, memory_bytes: 64 * 1024 ** 3, gpu: 8 };
  const profileDefaults = selectedProfile ? profileResources(selectedProfile, limits) : null;
  const usingProfileDefaults = !profileDefaults || (resources.cpu === profileDefaults.cpu &&
    resources.memory_bytes === profileDefaults.memory_bytes && resources.gpu === profileDefaults.gpu && !resources.architecture);
  const selectedContainer = ENVIRONMENT_OPTIONS.find((option) => option.id === environment)?.container;
  const selectedServiceRunning = normalizeStatus(statuses[selectedContainer]) === 'running' && !launchSucceeded;
  const selectedEnvironmentLabel = ENVIRONMENT_OPTIONS.find((option) => option.id === environment)?.label;
  const validationState = validating ? 'Validating' : validationError ? 'Validation failed' : isValidated ? 'Validated' : 'Not validated';
  const currentStep = isValidated ? 6 : 4;
  const workflowSteps = [
    ['profile-heading', 'Profile'], ['environment-heading', 'Environment'], ['objects-heading', 'Objects'],
    ['compute-heading', 'Compute'], ['review-heading', 'Review'], ['launch-heading', 'Launch'],
  ];

  return (
    <main id="main-content" className="workspace-shell">
      <div className="workspace-intro">
        <h1>Workspace Launcher</h1>
        <p>Choose a profile and environment. Open a running environment, or validate and launch it with new resources.</p>
      </div>

      <nav className="workflow-bar" aria-label="Workspace workflow">
        <ol>{workflowSteps.map(([target, label], index) => {
          const number = index + 1;
          const state = number === currentStep ? 'current' : number < currentStep ? 'completed' : 'upcoming';
          return <li key={target} className={`workflow-step workflow-step--${state}`}>
            <a href={`#${target}`} aria-current={state === 'current' ? 'step' : undefined}>
              <span className="workflow-step-number">{number}</span><span>{label}</span>
            </a>
          </li>;
        })}</ol>
      </nav>

      <div className="workspace-layout">
        <div className="workspace-config">
          <section className="config-panel" aria-labelledby="profile-heading">
            <div className="panel-heading"><div><span className="step-number">01</span><h2 id="profile-heading">Choose Workspace Profile</h2></div><span className="optional-label">Required</span></div>
            {profilesError && <div className="inline-message inline-message--error" role="alert">{profilesError}</div>}
            {!profiles.length && !profilesError && <div className="profile-skeleton" aria-label="Loading workspace profiles">Loading profiles…</div>}
            <div className="profile-grid" role="radiogroup" aria-label="Workspace profile">{profiles.map((profile) => <ProfileCard key={profile.id} profile={profile} selected={profile.id === profileId} onSelect={(next) => selectProfile(profiles.find((item) => item.id === next.id) || profile)} profileIds={profiles.filter(profileIsAvailable).map((item) => item.id)} />)}</div>
          </section>

          <section className="config-panel" aria-labelledby="environment-heading">
            <div className="panel-heading"><div><span className="step-number">02</span><h2 id="environment-heading">Select Environment</h2></div><span className="optional-label">Required</span></div>
            <div className="ide-grid" role="radiogroup" aria-label="Workspace environment">{ENVIRONMENT_OPTIONS.map((option) => <EnvironmentCard key={option.id} option={option} selected={environment === option.id} compatible={ideIsCompatible(selectedProfile, option.id)} profileName={selectedProfile?.name} status={statuses[option.container]} onOpen={onOpenIde} environmentIds={ENVIRONMENT_OPTIONS.filter((item) => ideIsCompatible(selectedProfile, item.id)).map((item) => item.id)} onSelect={(next) => { setEnvironment(next); markDirty(); }} />)}</div>
          </section>

          <section className="config-panel" aria-labelledby="objects-heading">
            <div className="panel-heading"><div><span className="step-number">03</span><h2 id="objects-heading">Attach OmniBioAI Objects</h2></div><span className="optional-label">Optional</span></div>
            <ObjectReferenceEditor objects={objects} onBrowseObjects={onBrowseObjects} browseButtonRef={browseButtonRef} onChange={(next) => { setObjects(next); markDirty(); }} />
          </section>

          <section className="config-panel" aria-labelledby="compute-heading">
            <div className="panel-heading"><div><span className="step-number">04</span><h2 id="compute-heading">Configure Compute</h2></div><span className="optional-label">{usingProfileDefaults ? 'Profile defaults applied' : 'Customized'}</span></div>
            <div className="resource-grid">
              <label><span id="cpu-label">CPU</span><div className="range-number"><input aria-labelledby="cpu-label" type="range" min="0.25" max={resourceMax.cpu} step="0.25" value={resources.cpu} onChange={(event) => { setResources({ ...resources, cpu: Number(event.target.value) }); markDirty(); }} /><input aria-label="CPU value" type="number" min="0.25" max={resourceMax.cpu} step="0.25" value={resources.cpu} onChange={(event) => { setResources({ ...resources, cpu: Number(event.target.value) }); markDirty(); }} /></div></label>
              <label><span id="memory-label">Memory (GiB)</span><div className="range-number"><input aria-labelledby="memory-label" type="range" min="0.25" max={resourceMax.memory_bytes / 1024 ** 3} step="0.25" value={resources.memory_bytes / 1024 ** 3} onChange={(event) => { setResources({ ...resources, memory_bytes: gibToBytes(event.target.value) }); markDirty(); }} /><input aria-label="Memory value in GiB" type="number" min="0.25" max={resourceMax.memory_bytes / 1024 ** 3} step="0.25" value={resources.memory_bytes / 1024 ** 3} onChange={(event) => { setResources({ ...resources, memory_bytes: gibToBytes(event.target.value) }); markDirty(); }} /></div></label>
              <label><span id="gpu-label">GPU</span><div className="range-number"><input aria-labelledby="gpu-label" type="range" min="0" max={resourceMax.gpu} step="1" value={resources.gpu} disabled={resourceMax.gpu === 0} onChange={(event) => { setResources({ ...resources, gpu: Number(event.target.value) }); markDirty(); }} /><input aria-label="GPU value" type="number" min="0" max={resourceMax.gpu} step="1" value={resources.gpu} disabled={resourceMax.gpu === 0} onChange={(event) => { setResources({ ...resources, gpu: Number(event.target.value) }); markDirty(); }} /></div><small>{resourceMax.gpu === 0 ? 'GPU requests are disabled in this deployment.' : 'Requested only; availability is verified at launch.'}</small></label>
              <label><span>Architecture</span><select aria-label="Architecture" value={resources.architecture} onChange={(event) => { setResources({ ...resources, architecture: event.target.value }); markDirty(); }}><option value="">Auto</option><option value="amd64">amd64</option><option value="arm64">arm64</option></select></label>
            </div>
            <details className="advanced-details"><summary>Advanced resource details</summary><p>Server limits: up to {resourceMax.cpu} CPU, {formatMemory(resourceMax.memory_bytes)} memory, and {resourceMax.gpu} requested GPUs. Docker compatibility and actual GPU allocation are verified server-side.</p></details>
          </section>

          {debugFromRunAvailable && <section className="config-panel debug-panel" aria-labelledby="debug-heading">
            <div className="panel-heading"><div><span className="step-number">◇</span><h2 id="debug-heading">Debug from Run</h2></div><span className="optional-label">Deployment dependent</span></div>
            <div className="object-input-row"><label className="sr-only" htmlFor="run-reference">Run reference</label><input id="run-reference" value={runReference} onChange={(event) => setRunReference(event.target.value)} placeholder="omnibioai://run/<id>" /><button type="button" className="button button--secondary" disabled={debugging} onClick={debugFromRun}>{debugging ? 'Checking…' : 'Debug from Run'}</button></div>
            {debugMessage && <p className="field-help" role="status">{debugMessage}</p>}
          </section>}
        </div>

        <div className="workspace-review-column">
          <div id="review-heading"><WorkspacePreview profile={selectedProfile} environment={environment} resources={resources} objects={objects} validation={isValidated ? validation : null} validationState={validationState} manifest={launchResult?.manifest} manifestError={manifestError} /></div>
          <div className="launch-panel" id="launch-heading">
            {validationError && <div className="inline-message inline-message--error" role="alert">{validationError}</div>}
            {launchError && <div className="inline-message inline-message--error" role="alert">{launchError}</div>}
            {launchSucceeded && <div className="inline-message inline-message--success" role="status">Workspace {launchResult.workspace_id} is running.</div>}
            {selectedServiceRunning && <div className="inline-message inline-message--info" role="status">{selectedEnvironmentLabel} is already running{environment === 'vscode' || environment === 'terminal' ? ' (VS Code and Terminal share one container)' : ''}. Open it, or stop it to launch with new resource settings.</div>}
            {selectedServiceRunning && <button type="button" className="button button--primary button--wide" onClick={() => onOpenIde(environment)}>Open {selectedEnvironmentLabel} ↗</button>}
            <button type="button" className="button button--secondary button--wide" disabled={validating || launching || !profileId} onClick={validate}>{validating ? 'Validating…' : 'Validate configuration'}</button>
            <button type="button" className={`button ${selectedServiceRunning ? 'button--secondary' : 'button--primary'} button--wide`} disabled={!isValidated || launching || validating || !profileId || selectedServiceRunning} aria-disabled={!isValidated || launching || validating || !profileId || selectedServiceRunning} onClick={launch}>{launching ? 'Launching workspace…' : 'Launch Workspace'}</button>
            {!isValidated && !selectedServiceRunning && <p className="launch-helper">Validate the configuration to enable launch.</p>}
            {launchSucceeded && <button type="button" className="button button--open button--wide" onClick={() => onOpenIde(environment)}>Open {ENVIRONMENT_OPTIONS.find((option) => option.id === environment)?.label} ↗</button>}
            <p>Launch validates the request, applies CPU and memory limits to the selected shared <strong>{selectedEnvironmentLabel || 'environment'}</strong> container, verifies architecture and GPU compatibility, then starts that service. It requires workspace launch permission.</p>
          </div>
        </div>
      </div>
    </main>
  );
}

export { ENVIRONMENT_OPTIONS, OBJECT_REFERENCE, safeForDisplay };

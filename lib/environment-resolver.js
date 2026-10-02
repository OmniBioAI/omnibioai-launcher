'use strict';

const { ValidationError, ResolutionError } = require('./errors');
const { ARCHITECTURES, SAFE_IMAGE, DIGEST } = require('./workspace-spec');
const { getProfile } = require('./profiles');

const CONTAINER_BY_IDE = Object.freeze({
  jupyterlab: 'omnibioai-jupyter',
  rstudio: 'omnibioai-rstudio',
  vscode: 'omnibioai-vscode',
});
const BASE_CAPABILITIES = Object.freeze({
  jupyterlab: Object.freeze(['python']),
  rstudio: Object.freeze(['r']),
  vscode: Object.freeze(['python', 'r']),
});

function hostArchitecture() {
  if (process.arch === 'arm64') return 'arm64';
  return 'amd64';
}

function builtInCandidates() {
  return Object.entries(CONTAINER_BY_IDE).map(([ide, container]) => ({
    id: `local-${ide}`,
    ide,
    container,
    architectures: [hostArchitecture()],
    capabilities: [...BASE_CAPABILITIES[ide]],
    gpu_available: 0,
    environment: { source: 'local-container' },
  }));
}

function validateCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new ValidationError('environment candidate must be an object');
  const allowed = ['id', 'ide', 'container', 'architectures', 'capabilities', 'gpu_available', 'image_reference', 'image_digest', 'environment'];
  const unknown = Object.keys(candidate).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new ValidationError(`environment candidate contains unsupported fields: ${unknown.join(', ')}`);
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(candidate.id || '')) throw new ValidationError('invalid environment candidate id');
  if (CONTAINER_BY_IDE[candidate.ide] !== candidate.container) throw new ValidationError('environment candidate targets an unsupported container');
  if (!Array.isArray(candidate.architectures) || !candidate.architectures.length || candidate.architectures.some((a) => !ARCHITECTURES.includes(a))) {
    throw new ValidationError('environment candidate has invalid architectures');
  }
  if (!Array.isArray(candidate.capabilities) || candidate.capabilities.some((c) => !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(c))) {
    throw new ValidationError('environment candidate has invalid capabilities');
  }
  if (!Number.isInteger(candidate.gpu_available) || candidate.gpu_available < 0) throw new ValidationError('environment candidate has invalid GPU availability');
  if (candidate.image_reference !== undefined && !SAFE_IMAGE.test(candidate.image_reference)) throw new ValidationError('environment candidate has unsafe image reference');
  if (candidate.image_digest !== undefined && !DIGEST.test(candidate.image_digest)) throw new ValidationError('environment candidate has invalid image digest');
  if (candidate.environment !== undefined && (!candidate.environment || typeof candidate.environment !== 'object' || Array.isArray(candidate.environment))) {
    throw new ValidationError('environment candidate metadata must be an object');
  }
  return Object.freeze({ ...candidate, architectures: [...candidate.architectures], capabilities: [...candidate.capabilities], environment: { ...(candidate.environment || {}) } });
}

function loadCandidates(env = process.env) {
  if (!env.LAUNCHER_ENVIRONMENTS_JSON) return builtInCandidates().map(validateCandidate);
  let parsed;
  try { parsed = JSON.parse(env.LAUNCHER_ENVIRONMENTS_JSON); } catch { throw new ValidationError('LAUNCHER_ENVIRONMENTS_JSON is not valid JSON'); }
  if (!Array.isArray(parsed) || !parsed.length) throw new ValidationError('LAUNCHER_ENVIRONMENTS_JSON must contain candidates');
  return parsed.map(validateCandidate);
}

class ConfigEnvironmentResolver {
  constructor(candidates = loadCandidates()) {
    this.candidates = candidates.map(validateCandidate);
  }

  resolve(spec) {
    const profile = getProfile(spec.workspace.profile);
    const required = profile.required_capabilities || [];
    const candidates = this.candidates.filter((candidate) =>
      candidate.ide === spec.ide.type &&
      candidate.architectures.includes(spec.resources.architecture) &&
      spec.resources.gpu <= candidate.gpu_available &&
      required.every((capability) => candidate.capabilities.includes(capability)) &&
      (!spec.image || candidate.image_reference === spec.image.reference) &&
      (!spec.image?.digest || candidate.image_digest === spec.image.digest)
    );
    if (!candidates.length) throw new ResolutionError('no compatible configured environment was found');
    return candidates.sort((a, b) => a.id.localeCompare(b.id))[0];
  }
}

module.exports = { CONTAINER_BY_IDE, BASE_CAPABILITIES, hostArchitecture, builtInCandidates, validateCandidate, loadCandidates, ConfigEnvironmentResolver };

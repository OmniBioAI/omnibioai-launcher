'use strict';

const { ValidationError } = require('./errors');
const { normalizeObjectReference } = require('./object-reference');
const { getProfile } = require('./profiles');

const IDES = Object.freeze(['jupyterlab', 'rstudio', 'vscode', 'terminal']);
const ARCHITECTURES = Object.freeze(['amd64', 'arm64']);
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._()\/-]{0,99}$/;
const SAFE_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9.@_:-]{0,127}$/;
const SAFE_IMAGE = /^(?:[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[0-9]+)?\/)*(?:[a-z0-9]+(?:[._-][a-z0-9]+)*)(?::[A-Za-z0-9][A-Za-z0-9._-]{0,127})?(?:@sha256:[a-f0-9]{64})?$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;

function ownObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError(`${label} must be an object`);
  return value;
}

function onlyKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new ValidationError(`${label} contains unsupported fields: ${unknown.join(', ')}`);
}

function boundedNumber(value, label, min, max, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new ValidationError(`${label} must be ${integer ? 'an integer ' : ''}between ${min} and ${max}`);
  }
  return value;
}

function nonNegativeInteger(value, label, max) {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new ValidationError(`${label} must be an integer between 0 and ${max}`);
  }
  return value;
}

function limitsFromEnvironment(env = process.env) {
  const number = (name, fallback, min) => {
    const parsed = Number(env[name]);
    return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
  };
  const gpuValue = Number(env.WORKSPACE_MAX_GPU);
  return Object.freeze({
    cpu: number('WORKSPACE_MAX_CPU', 16, 0.25),
    memory_bytes: number('WORKSPACE_MAX_MEMORY_BYTES', 64 * 1024 ** 3, 256 * 1024 ** 2),
    gpu: Number.isInteger(gpuValue) && gpuValue >= 0 ? gpuValue : 8,
  });
}

function validateImage(image) {
  if (image === undefined) return undefined;
  ownObject(image, 'image');
  onlyKeys(image, ['reference', 'digest'], 'image');
  if (!SAFE_IMAGE.test(image.reference || '')) throw new ValidationError('unsafe or invalid image reference');
  if (image.digest !== undefined && !DIGEST.test(image.digest)) throw new ValidationError('invalid image digest');
  const referenceDigest = image.reference.match(/@(sha256:[a-f0-9]{64})$/)?.[1];
  if (referenceDigest && image.digest && referenceDigest !== image.digest) throw new ValidationError('image reference and digest do not match');
  return Object.freeze({ reference: image.reference, ...(image.digest && { digest: image.digest }) });
}

function validateWorkspaceRequest(input, { identity, limits = limitsFromEnvironment(), now = () => new Date(), launcherVersion = 'unknown' } = {}) {
  ownObject(input, 'workspace request');
  onlyKeys(input, ['workspace', 'ide', 'image', 'resources', 'objects'], 'workspace request');
  if (!identity || !SAFE_IDENTITY.test(identity.user_id || '') || !SAFE_IDENTITY.test(identity.organization_id || '')) {
    throw new ValidationError('authenticated user and organization identity are required');
  }

  const workspace = ownObject(input.workspace || {}, 'workspace');
  onlyKeys(workspace, ['id', 'name', 'profile'], 'workspace');
  if (workspace.id !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(workspace.id)) throw new ValidationError('invalid workspace id');
  if (workspace.name !== undefined && !SAFE_NAME.test(workspace.name)) throw new ValidationError('invalid workspace name');
  const profile = getProfile(workspace.profile || 'generic-python');

  const ideInput = ownObject(input.ide || { type: profile.preferred_ide }, 'ide');
  onlyKeys(ideInput, ['type'], 'ide');
  if (!IDES.includes(ideInput.type)) throw new ValidationError('unsupported IDE type');

  const requested = ownObject(input.resources || {}, 'resources');
  onlyKeys(requested, ['cpu', 'memory_bytes', 'gpu', 'architecture'], 'resources');
  const resources = Object.freeze({
    cpu: boundedNumber(requested.cpu ?? profile.resources.cpu, 'resources.cpu', 0.25, limits.cpu),
    memory_bytes: boundedNumber(requested.memory_bytes ?? profile.resources.memory_bytes, 'resources.memory_bytes', 256 * 1024 ** 2, limits.memory_bytes, true),
    gpu: nonNegativeInteger(requested.gpu ?? profile.resources.gpu, 'resources.gpu', limits.gpu),
    architecture: requested.architecture || (process.arch === 'arm64' ? 'arm64' : 'amd64'),
  });
  if (!ARCHITECTURES.includes(resources.architecture)) throw new ValidationError('unsupported architecture');

  if (input.objects !== undefined && !Array.isArray(input.objects)) throw new ValidationError('objects must be an array');
  if ((input.objects || []).length > 50) throw new ValidationError('at most 50 object references are allowed');
  const objects = Object.freeze((input.objects || []).map(normalizeObjectReference));

  return Object.freeze({
    schema_version: '1.0',
    workspace: Object.freeze({ ...(workspace.id && { id: workspace.id }), ...(workspace.name && { name: workspace.name }), profile: profile.id }),
    ide: Object.freeze({ type: ideInput.type }),
    ...(input.image && { image: validateImage(input.image) }),
    resources,
    objects,
    identity: Object.freeze({ user_id: identity.user_id, organization_id: identity.organization_id }),
    provenance: Object.freeze({ created_at: now().toISOString(), launcher_version: launcherVersion }),
  });
}

module.exports = { IDES, ARCHITECTURES, SAFE_IMAGE, DIGEST, limitsFromEnvironment, validateImage, validateWorkspaceRequest };

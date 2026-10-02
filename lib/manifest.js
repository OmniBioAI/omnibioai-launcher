'use strict';

const { ValidationError } = require('./errors');
const { ARCHITECTURES, SAFE_IMAGE, validateImage } = require('./workspace-spec');
const { IDES } = require('./workspace-spec');
const { normalizeObjectReference } = require('./object-reference');

const SECRET_KEY = /(authorization|bearer|token|secret|password|passwd|credential|api[_-]?key|private[_-]?key)/i;
const MANIFEST_KEYS = ['schema_version', 'workspace_id', 'workspace_name', 'profile', 'ide', 'image', 'resources', 'objects', 'identity', 'created_at', 'launcher_version', 'environment', 'provenance'];
const SAFE_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9.@_:-]{0,127}$/;

function exactKeys(value, allowed, label) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new ValidationError(`${label} contains unsupported fields: ${unknown.join(', ')}`);
}

function assertNoSecrets(value, path = 'manifest') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) throw new ValidationError(`${path} contains a secret-like field`);
    assertNoSecrets(child, `${path}.${key}`);
  }
}

function plainMetadata(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError(`${label} must be an object`);
  for (const [key, item] of Object.entries(value)) {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(key) || SECRET_KEY.test(key)) throw new ValidationError(`${label} contains an unsafe key`);
    if (!['string', 'number', 'boolean'].includes(typeof item) && item !== null) throw new ValidationError(`${label} values must be scalar`);
    if (typeof item === 'string' && item.length > 512) throw new ValidationError(`${label} value is too long`);
  }
  return { ...value };
}

function validateManifest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ValidationError('manifest must be an object');
  const unknown = Object.keys(input).filter((key) => !MANIFEST_KEYS.includes(key));
  if (unknown.length) throw new ValidationError(`manifest contains unsupported fields: ${unknown.join(', ')}`);
  assertNoSecrets(input);
  if (input.schema_version !== '1.0') throw new ValidationError('unsupported manifest schema version');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(input.workspace_id || '')) throw new ValidationError('invalid manifest workspace id');
  if (input.workspace_name !== undefined && (typeof input.workspace_name !== 'string' || input.workspace_name.length > 100)) throw new ValidationError('invalid manifest workspace name');
  if (typeof input.profile !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(input.profile)) throw new ValidationError('invalid manifest profile');
  if (!IDES.includes(input.ide)) throw new ValidationError('invalid manifest IDE');
  if (!input.image || !SAFE_IMAGE.test(input.image.reference || '')) throw new ValidationError('invalid manifest image reference');
  exactKeys(input.image, ['reference', 'digest'], 'manifest image');
  const image = validateImage(input.image);
  const resources = input.resources;
  if (resources && typeof resources === 'object' && !Array.isArray(resources)) exactKeys(resources, ['cpu', 'memory_bytes', 'gpu', 'architecture'], 'manifest resources');
  if (!resources || typeof resources !== 'object' || !Number.isFinite(resources.cpu) || resources.cpu <= 0 ||
      !Number.isFinite(resources.memory_bytes) || resources.memory_bytes <= 0 || !Number.isInteger(resources.gpu) || resources.gpu < 0 ||
      !ARCHITECTURES.includes(resources.architecture)) throw new ValidationError('invalid manifest resources');
  if (!Array.isArray(input.objects)) throw new ValidationError('invalid manifest objects');
  const objects = input.objects.map(normalizeObjectReference);
  if (!input.identity || typeof input.identity !== 'object' || Array.isArray(input.identity)) throw new ValidationError('invalid manifest identity');
  exactKeys(input.identity, ['user_id', 'organization_id'], 'manifest identity');
  if (!SAFE_IDENTITY.test(input.identity.user_id || '') || !SAFE_IDENTITY.test(input.identity.organization_id || '')) {
    throw new ValidationError('invalid manifest identity');
  }
  if (!Number.isFinite(Date.parse(input.created_at))) throw new ValidationError('invalid manifest creation timestamp');
  if (typeof input.launcher_version !== 'string' || !input.launcher_version) throw new ValidationError('invalid launcher version');
  return Object.freeze({
    schema_version: '1.0', workspace_id: input.workspace_id,
    ...(input.workspace_name && { workspace_name: input.workspace_name }),
    profile: input.profile, ide: input.ide, image: Object.freeze(image), resources: Object.freeze({ ...resources }),
    objects: Object.freeze(objects), identity: Object.freeze({ ...input.identity }), created_at: new Date(input.created_at).toISOString(),
    launcher_version: input.launcher_version, environment: Object.freeze(plainMetadata(input.environment || {}, 'environment')),
    provenance: Object.freeze(plainMetadata(input.provenance || {}, 'provenance')),
  });
}

function createManifest({ spec, environment, workspaceId, image }) {
  return validateManifest({
    schema_version: '1.0', workspace_id: workspaceId,
    ...(spec.workspace.name && { workspace_name: spec.workspace.name }),
    profile: spec.workspace.profile, ide: spec.ide.type, image,
    resources: spec.resources, objects: spec.objects, identity: spec.identity,
    created_at: spec.provenance.created_at, launcher_version: spec.provenance.launcher_version,
    environment: environment.environment || {},
    provenance: { resolver: 'local-config-v1', candidate_id: environment.id },
  });
}

function serializeManifest(manifest) {
  return JSON.stringify(validateManifest(manifest));
}

function deserializeManifest(serialized) {
  if (typeof serialized !== 'string') throw new ValidationError('serialized manifest must be a string');
  let parsed;
  try { parsed = JSON.parse(serialized); } catch { throw new ValidationError('manifest is not valid JSON'); }
  return validateManifest(parsed);
}

module.exports = { SECRET_KEY, assertNoSecrets, validateManifest, createManifest, serializeManifest, deserializeManifest };

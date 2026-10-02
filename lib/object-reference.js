'use strict';

const { ValidationError } = require('./errors');

const OBJECT_TYPES = Object.freeze(['dataset', 'workflow', 'model', 'run', 'tool']);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const URI = /^omnibioai:\/\/(dataset|workflow|model|run|tool)\/([A-Za-z0-9][A-Za-z0-9._:-]{0,127})$/;

function parseObjectReference(value) {
  if (typeof value !== 'string') throw new ValidationError('object reference must be a string');
  const match = URI.exec(value);
  if (!match) throw new ValidationError('malformed or unsupported OmniBioAI object reference');
  return Object.freeze({ type: match[1], id: match[2], uri: `omnibioai://${match[1]}/${match[2]}` });
}

function normalizeObjectReference(value) {
  if (typeof value === 'string') return parseObjectReference(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('object reference must be a URI or {type, id}');
  }
  const keys = Object.keys(value);
  if (keys.length === 3 && keys.every((key) => ['type', 'id', 'uri'].includes(key))) {
    const parsed = parseObjectReference(value.uri);
    if (parsed.type !== value.type || parsed.id !== value.id) throw new ValidationError('inconsistent canonical object reference');
    return parsed;
  }
  if (keys.some((key) => !['type', 'id'].includes(key)) || keys.length !== 2) {
    throw new ValidationError('object reference contains unsupported fields');
  }
  if (!OBJECT_TYPES.includes(value.type) || !IDENTIFIER.test(value.id || '')) {
    throw new ValidationError('invalid OmniBioAI object type or identifier');
  }
  return parseObjectReference(`omnibioai://${value.type}/${value.id}`);
}

function serializeObjectReference(value) {
  return normalizeObjectReference(value).uri;
}

module.exports = { OBJECT_TYPES, parseObjectReference, normalizeObjectReference, serializeObjectReference };

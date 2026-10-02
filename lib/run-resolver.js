'use strict';

const { parseObjectReference } = require('./object-reference');

class RunMetadataResolver {
  async resolve() {
    const error = new Error('run metadata integration is not configured');
    error.status = 501;
    throw error;
  }
}

async function workspaceRequestFromRun(runReference, { resolver = new RunMetadataResolver(), authorize }) {
  const reference = parseObjectReference(runReference);
  if (reference.type !== 'run') {
    const error = new Error('a run reference is required');
    error.status = 400;
    throw error;
  }
  if (typeof authorize !== 'function') {
    const error = new Error('run authorization integration is not configured');
    error.status = 501;
    throw error;
  }
  const allowed = await authorize(reference);
  if (allowed !== true) {
    const error = new Error('run access denied');
    error.status = 403;
    throw error;
  }
  return resolver.resolve(reference);
}

module.exports = { RunMetadataResolver, workspaceRequestFromRun };

'use strict';

const { ValidationError } = require('./errors');

const PROFILES = Object.freeze({
  'generic-python': Object.freeze({
    id: 'generic-python', name: 'Generic Python', preferred_ide: 'jupyterlab',
    resources: Object.freeze({ cpu: 2, memory_bytes: 4 * 1024 ** 3, gpu: 0 }),
    required_capabilities: Object.freeze(['python']), environment: Object.freeze({ language: 'python' }),
  }),
  'generic-r': Object.freeze({
    id: 'generic-r', name: 'Generic R', preferred_ide: 'rstudio',
    resources: Object.freeze({ cpu: 2, memory_bytes: 4 * 1024 ** 3, gpu: 0 }),
    required_capabilities: Object.freeze(['r']), environment: Object.freeze({ language: 'r' }),
  }),
  'rna-seq': Object.freeze({
    id: 'rna-seq', name: 'RNA-seq', preferred_ide: 'jupyterlab',
    resources: Object.freeze({ cpu: 4, memory_bytes: 16 * 1024 ** 3, gpu: 0 }),
    required_capabilities: Object.freeze(['python', 'rna-seq']), environment: Object.freeze({ domain: 'transcriptomics' }),
  }),
  'single-cell': Object.freeze({
    id: 'single-cell', name: 'Single-cell', preferred_ide: 'jupyterlab',
    resources: Object.freeze({ cpu: 4, memory_bytes: 16 * 1024 ** 3, gpu: 0 }),
    required_capabilities: Object.freeze(['python', 'single-cell']), environment: Object.freeze({ domain: 'single-cell' }),
  }),
  'variant-analysis': Object.freeze({
    id: 'variant-analysis', name: 'Variant analysis', preferred_ide: 'jupyterlab',
    resources: Object.freeze({ cpu: 4, memory_bytes: 16 * 1024 ** 3, gpu: 0 }),
    required_capabilities: Object.freeze(['python', 'variant-analysis']), environment: Object.freeze({ domain: 'genomics' }),
  }),
  proteomics: Object.freeze({
    id: 'proteomics', name: 'Proteomics', preferred_ide: 'jupyterlab',
    resources: Object.freeze({ cpu: 4, memory_bytes: 16 * 1024 ** 3, gpu: 0 }),
    required_capabilities: Object.freeze(['python', 'proteomics']), environment: Object.freeze({ domain: 'proteomics' }),
  }),
  'ml-ai-development': Object.freeze({
    id: 'ml-ai-development', name: 'ML/AI development', preferred_ide: 'vscode',
    resources: Object.freeze({ cpu: 4, memory_bytes: 16 * 1024 ** 3, gpu: 0 }),
    gpu_preference: true, required_capabilities: Object.freeze(['python', 'ml']), environment: Object.freeze({ domain: 'machine-learning' }),
  }),
});

function listProfiles() {
  return Object.values(PROFILES).map((profile) => JSON.parse(JSON.stringify(profile)));
}

function getProfile(id) {
  const profile = PROFILES[id];
  if (!profile) throw new ValidationError('unsupported workspace profile');
  return profile;
}

module.exports = { PROFILES, listProfiles, getProfile };

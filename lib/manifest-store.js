'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ValidationError } = require('./errors');
const { deserializeManifest, serializeManifest } = require('./manifest');

const STATE_FILE = 'manifests.json';
const FILE_VERSION = 1;

function manifestKey(identity, workspaceId) {
  return `${identity.organization_id}\u0000${identity.user_id}\u0000${workspaceId}`;
}

function assertBelongsTo(manifest, identity, workspaceId) {
  if (manifest.workspace_id !== workspaceId || manifest.identity.user_id !== identity.user_id ||
      manifest.identity.organization_id !== identity.organization_id) {
    throw new ValidationError('manifest does not belong to its storage key');
  }
}

// Workspace manifests keyed by organization + user + workspace id. With `dir`
// they are persisted to <dir>/manifests.json so they survive a restart; without
// it they live only in this process. Every manifest passes lib/manifest.js
// validation on the way in (set, startup load) and again on the way out (get),
// so a hand-edited or corrupted state file can't serve an invalid or
// secret-bearing manifest.
class ManifestStore {
  constructor({ dir, logger = console } = {}) {
    this.logger = logger;
    this.entries = new Map();
    this.dir = dir || null;
    this.file = this.dir ? path.join(this.dir, STATE_FILE) : null;
    if (!this.file) return;
    // Fail at startup, not on the first launch, when the directory is unusable.
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    fs.accessSync(this.dir, fs.constants.W_OK);
    this.load();
  }

  load() {
    let raw;
    try { raw = fs.readFileSync(this.file, 'utf8'); } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    let parsed;
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
    if (!parsed || parsed.version !== FILE_VERSION || !Array.isArray(parsed.manifests)) {
      // Keep the unreadable file for inspection rather than overwriting it on
      // the next launch.
      const aside = `${this.file}.corrupt-${Date.now()}`;
      fs.renameSync(this.file, aside);
      this.logger.error(`launcher: ${this.file} is not a valid manifest state file; moved it to ${aside} and started empty`);
      return;
    }
    let skipped = 0;
    for (const entry of parsed.manifests) {
      try {
        const identity = { user_id: entry?.user_id, organization_id: entry?.organization_id };
        const serialized = serializeManifest(entry?.manifest);
        assertBelongsTo(deserializeManifest(serialized), identity, entry.workspace_id);
        this.entries.set(manifestKey(identity, entry.workspace_id), { ...identity, workspace_id: entry.workspace_id, serialized });
      } catch {
        skipped += 1;
      }
    }
    if (skipped) this.logger.error(`launcher: skipped ${skipped} invalid manifest(s) in ${this.file}`);
  }

  has(identity, workspaceId) {
    return this.entries.has(manifestKey(identity, workspaceId));
  }

  get(identity, workspaceId) {
    const entry = this.entries.get(manifestKey(identity, workspaceId));
    if (!entry) return null;
    try {
      const manifest = deserializeManifest(entry.serialized);
      assertBelongsTo(manifest, identity, workspaceId);
      return manifest;
    } catch {
      this.logger.error('launcher: refusing to serve a stored manifest that failed validation');
      return null;
    }
  }

  set(identity, workspaceId, manifest) {
    const serialized = serializeManifest(manifest);
    assertBelongsTo(deserializeManifest(serialized), identity, workspaceId);
    const key = manifestKey(identity, workspaceId);
    const previous = this.entries.get(key);
    this.entries.set(key, { user_id: identity.user_id, organization_id: identity.organization_id, workspace_id: workspaceId, serialized });
    try {
      this.persist();
    } catch (error) {
      if (previous) this.entries.set(key, previous); else this.entries.delete(key);
      throw error;
    }
  }

  delete(identity, workspaceId) {
    if (this.entries.delete(manifestKey(identity, workspaceId))) this.persist();
  }

  clear() {
    this.entries.clear();
    this.persist();
  }

  // Write a temp file in the same directory, fsync it, then rename over the
  // state file: readers and a crash mid-write see either the old file or the
  // new one, never a partial one. Writes are synchronous, so concurrent
  // requests in this process can't interleave them.
  persist() {
    if (!this.file) return;
    const body = JSON.stringify({
      version: FILE_VERSION,
      manifests: [...this.entries.values()].map(({ serialized, ...key }) => ({ ...key, manifest: JSON.parse(serialized) })),
    });
    const temp = `${this.file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    try {
      const fd = fs.openSync(temp, 'wx', 0o600);
      try {
        fs.writeSync(fd, body);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(temp, this.file);
    } catch (error) {
      fs.rmSync(temp, { force: true });
      throw error;
    }
    // Make the rename itself durable. Not every platform can fsync a directory.
    try {
      const dirFd = fs.openSync(this.dir, 'r');
      try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    } catch { /* best effort */ }
  }
}

module.exports = { ManifestStore, STATE_FILE, manifestKey };

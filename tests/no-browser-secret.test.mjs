// Guards against a privileged credential being compiled into the Launcher's
// browser bundle.
//
// Create React App inlines every REACT_APP_* variable into public JavaScript.
// This UI once received the Jupyter token through one (REACT_APP_JUPYTER_TOKEN),
// which made a working Jupyter credential downloadable by anyone who could fetch
// the page. Policy: PUBLIC configuration (URLs, flags) may be a REACT_APP_
// variable; a reusable CREDENTIAL never may. These tests use SYNTHETIC sentinels
// only -- never a real credential -- and prove the policy on a real production
// build, including source maps.
//
// Run: npm run test:security   (performs a production build, ~30-60s)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SENTINEL = 'OMNIBIOAI_TEST_SECRET_DO_NOT_SHIP';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Explicit policy, shared with the build guard (scripts/check-build-env.js).
// Adding a name there is a deliberate statement that its value is public: a URL
// or a flag, never a credential.
const PUBLIC_BROWSER_CONFIG = new Set(JSON.parse(readFileSync(join(ROOT, 'scripts', 'public-browser-config.json'), 'utf8')));
const SECRET_LIKE = /(TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|API_?KEY|PRIVATE)/i;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

test('browser source reads only allowlisted public REACT_APP_ variables', () => {
  const sources = walk(join(ROOT, 'src')).filter((f) => /\.(jsx?|tsx?)$/.test(f) && !/\.test\./.test(f));
  for (const file of sources) {
    const text = readFileSync(file, 'utf8');
    for (const [, name] of text.matchAll(/process\.env\.(REACT_APP_[A-Z0-9_]+)/g)) {
      assert.ok(PUBLIC_BROWSER_CONFIG.has(name), `${relative(ROOT, file)} reads ${name}, which is not an approved public config variable`);
      assert.ok(!SECRET_LIKE.test(name), `${relative(ROOT, file)} reads secret-looking variable ${name}`);
    }
    assert.ok(!/[?&]token=/.test(text), `${relative(ROOT, file)} builds a URL that carries a token`);
  }
});

test('the Docker build stage passes no secret-looking REACT_APP_ argument', () => {
  const dockerfile = readFileSync(join(ROOT, 'Dockerfile'), 'utf8');
  const builder = dockerfile.slice(0, dockerfile.indexOf('# ── Stage 2'));
  assert.ok(builder.includes('AS builder'), 'could not locate the builder stage');
  for (const line of builder.split('\n').filter((l) => !l.trim().startsWith('#'))) {
    for (const [, name] of line.matchAll(/(REACT_APP_[A-Z0-9_]+)/g)) {
      assert.ok(PUBLIC_BROWSER_CONFIG.has(name) && !SECRET_LIKE.test(name), `builder stage exposes ${name} to the bundle`);
    }
  }
});

function build(extraEnv) {
  const outDir = mkdtempSync(join(tmpdir(), 'launcher-build-'));
  const env = { ...process.env, BUILD_PATH: outDir, CI: 'false', GENERATE_SOURCEMAP: 'true', ...extraEnv };
  for (const key of Object.keys(env)) {
    // Start from a clean slate: nothing ambient may influence the result.
    if (key.startsWith('REACT_APP_') && !(key in extraEnv)) delete env[key];
  }
  // Real entry point (runs the "prebuild" guard, exactly as the Docker build does).
  const result = spawnSync('npm', ['run', 'build', '--silent'], { cwd: ROOT, env, encoding: 'utf8', timeout: 280_000 });
  return { outDir, result };
}

test('a secret-like REACT_APP_ variable makes the build FAIL, naming it but never printing its value', () => {
  for (const name of ['REACT_APP_JUPYTER_TOKEN', 'REACT_APP_OMNIBIOAI_TOKEN', 'REACT_APP_SECRET_KEY', 'REACT_APP_API_PASSWORD', 'REACT_APP_ANYTHING_NOT_APPROVED']) {
    const { outDir, result } = build({ [name]: SENTINEL });
    try {
      assert.notEqual(result.status, 0, `the build accepted ${name}`);
      const output = result.stdout + result.stderr;
      assert.ok(output.includes(name), `the failure did not name ${name}`);
      assert.ok(!output.includes(SENTINEL), `the guard printed the secret value for ${name}`);
      assert.ok(walkSafe(outDir).every((f) => !readFileSync(f).includes(SENTINEL)), `${name}: sentinel reached emitted files`);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  }
});

test('the same secrets supplied under NON-browser names emit ZERO occurrences (js, html, css, source maps)', () => {
  const secrets = Object.fromEntries(['JUPYTER_TOKEN', 'OMNIBIOAI_TOKEN', 'API_KEY', 'DB_PASSWORD'].map((n) => [n, SENTINEL]));
  const { outDir, result } = build({ ...secrets, REACT_APP_OMNIBIOAI_BASE_URL: 'http://public.example.test' });
  try {
    assert.equal(result.status, 0, `build failed:\n${(result.stdout + result.stderr).slice(-2000)}`);
    const files = walk(outDir);
    assert.ok(files.some((f) => f.endsWith('.js')), 'build emitted no JavaScript');
    assert.ok(files.some((f) => f.endsWith('.map')), 'source maps were not generated, so they were not scanned');
    assert.ok(files.some((f) => f.endsWith('.html')), 'build emitted no HTML');
    for (const file of files) {
      const bytes = readFileSync(file);
      assert.ok(!bytes.includes(SENTINEL), `sentinel secret leaked into ${relative(outDir, file)}`);
      for (const name of ['REACT_APP_JUPYTER_TOKEN', 'REACT_APP_OMNIBIOAI_TOKEN']) {
        assert.ok(!bytes.includes(name), `${relative(outDir, file)} contains the variable name ${name}`);
      }
    }
    // The guard must not over-block: approved public configuration still works.
    assert.ok(files.filter((f) => f.endsWith('.js')).some((f) => readFileSync(f).includes('public.example.test')), 'approved public config was not applied');
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

function walkSafe(dir) {
  try { return walk(dir); } catch { return []; }
}

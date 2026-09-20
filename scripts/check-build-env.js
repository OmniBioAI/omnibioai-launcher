'use strict';
// Runs before every `npm run build` (npm "prebuild" hook, so also in the Docker
// build stage). Fails the build if any REACT_APP_* variable outside the explicit
// PUBLIC allowlist is present -- in the environment or in a .env file.
//
// Why this must be a build-time gate and not just a source rule: Create React
// App's DefinePlugin inlines the ENTIRE set of REACT_APP_* variables (as one
// object literal) at every place the source reads any REACT_APP_ variable. A
// secret in REACT_APP_FOO is therefore published in the public bundle even if no
// source file ever reads REACT_APP_FOO. This UI once shipped its Jupyter token
// that way. Only public configuration (URLs, flags) may be a REACT_APP_ variable.
//
// Prints variable NAMES only, never values.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const PUBLIC = new Set(JSON.parse(fs.readFileSync(path.join(__dirname, 'public-browser-config.json'), 'utf8')));

const present = new Set(Object.keys(process.env).filter((k) => k.startsWith('REACT_APP_')));
for (const file of ['.env', '.env.local', '.env.production', '.env.production.local']) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) continue;
  for (const line of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?(REACT_APP_[A-Za-z0-9_]+)\s*=/);
    if (match) present.add(match[1]);
  }
}

const forbidden = [...present].filter((name) => !PUBLIC.has(name)).sort();
if (forbidden.length > 0) {
  console.error('\nRefusing to build: these REACT_APP_* variables are not approved public configuration:\n');
  for (const name of forbidden) console.error(`  - ${name}`);
  console.error(
    '\nEverything in a REACT_APP_* variable is compiled into the PUBLIC JavaScript bundle (Create React App\n' +
      'inlines the whole set, even variables the source never reads). Never pass a token, password, API key\n' +
      'or other reusable credential this way. If a variable really is public configuration, add it to\n' +
      'scripts/public-browser-config.json in a reviewed change.\n',
  );
  process.exit(1);
}

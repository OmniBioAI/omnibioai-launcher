import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {
  appearanceFromSearch,
  connectAppearanceMessages,
  EMBED_READY_EVENT,
  EMBED_THEME_EVENT,
  parseThemeMessage,
} from './embedAppearance';

const html = fs.readFileSync(path.resolve(process.cwd(), 'public/index.html'), 'utf8');
const bootstrap = html.match(/<script>\s*([\s\S]*?)\s*<\/script>/)?.[1];

function embedded(referrer = 'https://webstudio.omnibioai.org/workbench') {
  const listeners = new Map();
  const sent = [];
  const parent = { postMessage: (message, origin) => sent.push([message, origin]) };
  const win = {
    parent,
    addEventListener: (type, handler) => listeners.set(type, handler),
    removeEventListener: type => listeners.delete(type),
  };
  const root = { dataset: {}, style: { cssText: 'untouched' }, innerHTML: 'untouched' };
  return { win, doc: { referrer, documentElement: root }, parent, root, listeners, sent };
}

test('pre-paint bootstrap runs before styles and accepts only bounded parameters', () => {
  expect(bootstrap).toBeTruthy();
  expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('<link'));
  const location = {
    pathname: '/_svc/launcher',
    search: '?obai_theme=%3Csvg%3E&obai_accent=purple&obai_density=compact&obai_motion=reduce&obai_owner=x&token=x&author=Jane&username=reader',
    hash: '#go',
  };
  let replaced;
  const root = { dataset: {}, style: { cssText: 'untouched' }, innerHTML: 'untouched' };
  const windowObject = { location, matchMedia: () => ({ matches: false }), history: { replaceState: (_s, _t, url) => { replaced = url; } } };
  windowObject.parent = windowObject;
  vm.runInNewContext(bootstrap, {
    window: windowObject,
    document: { documentElement: root }, URLSearchParams, Object,
  });
  expect(root.dataset).toEqual({ theme: 'light', accent: 'purple', density: 'compact', motion: 'reduce', embedded: 'false' });
  const clean = new URL(replaced, 'https://launcher.example');
  expect(clean.searchParams.has('obai_owner')).toBe(false);
  expect(clean.searchParams.has('token')).toBe(false);
  expect(clean.searchParams.get('author')).toBe('Jane');
  expect(clean.searchParams.get('username')).toBe('reader');
  expect(clean.hash).toBe('#go');
  expect(root.style.cssText).toBe('untouched');
  expect(root.innerHTML).toBe('untouched');
});

test('search values normalize to allowlisted enums', () => {
  expect(appearanceFromSearch('?obai_theme=dark&obai_accent=orange&obai_density=compact&obai_motion=reduce')).toEqual({
    theme: 'dark', accent: 'orange', density: 'compact', motion: 'reduce',
  });
  expect(appearanceFromSearch('?obai_theme=javascript&obai_accent=%3Csvg%3E&obai_density=huge&obai_motion=auto', 'light')).toEqual({
    theme: 'light', accent: 'teal', density: 'comfortable', motion: 'system',
  });
});

test('parent handshake requires exact allowed origin, parent source, and exact message fields', () => {
  const { win, doc, parent, root, listeners, sent } = embedded();
  const stop = connectAppearanceMessages(win, doc, 'http://localhost:5174');
  expect(sent).toEqual([[{ type: EMBED_READY_EVENT }, 'https://webstudio.omnibioai.org']]);
  const listener = listeners.get('message');
  const message = { type: EMBED_THEME_EVENT, theme: 'light', accent: 'blue', density: 'compact', motion: 'reduce' };
  const deliver = (origin, source, data) => listener({ origin, source, data });
  deliver('https://evil.example', parent, message);
  deliver('https://webstudio.omnibioai.org', {}, message);
  deliver('https://webstudio.omnibioai.org', parent, { ...message, token: 'secret' });
  deliver('https://webstudio.omnibioai.org', parent, { ...message, username: 'reader' });
  deliver('https://webstudio.omnibioai.org', parent, { ...message, accent: 'javascript:alert(1)' });
  expect(root.dataset).toEqual({});
  expect(parseThemeMessage({ ...message, username: 'reader' })).toBeNull();
  deliver('https://webstudio.omnibioai.org', parent, message);
  expect(root.dataset).toEqual({ theme: 'light', accent: 'blue', density: 'compact', motion: 'reduce' });
  expect(root.style.cssText).toBe('untouched');
  expect(root.innerHTML).toBe('untouched');
  stop();
  expect(listeners.has('message')).toBe(false);
});

test('development origin must be configured exactly; untrusted and top-level contexts are ignored', () => {
  const valid = embedded('http://localhost:5174/');
  connectAppearanceMessages(valid.win, valid.doc, 'http://localhost:5174');
  expect(valid.sent).toEqual([[{ type: EMBED_READY_EVENT }, 'http://localhost:5174']]);
  const bad = embedded('http://localhost:5174/');
  connectAppearanceMessages(bad.win, bad.doc, 'http://localhost:5174.attacker.example');
  expect(bad.sent).toEqual([]);
  expect(bad.listeners.has('message')).toBe(false);
  const untrusted = embedded('https://evil.example/');
  connectAppearanceMessages(untrusted.win, untrusted.doc, 'http://localhost:5174');
  expect(untrusted.sent).toEqual([]);
  const top = embedded('');
  top.win.parent = top.win;
  connectAppearanceMessages(top.win, top.doc, 'http://localhost:5174');
  expect(top.sent).toEqual([]);
});

test('CSP protects normal, error, and asset responses; embedded logo header is hidden', () => {
  const nginx = fs.readFileSync(path.resolve(process.cwd(), 'nginx.conf'), 'utf8');
  expect(nginx.match(/add_header Content-Security-Policy "frame-ancestors 'self' https:\/\/webstudio\.omnibioai\.org" always;/g)).toHaveLength(2);
  expect(nginx).toContain('try_files $uri =404;');
  expect(fs.readFileSync(path.resolve(process.cwd(), 'src/App.css'), 'utf8')).toContain('html[data-embedded="true"] .header { display: none; }');
  expect(fs.readFileSync(path.resolve(process.cwd(), 'src/App.css'), 'utf8')).toContain('html[data-embedded="true"] .brand-lockup { display: none; }');
});

test('vendored tokens are 1.1.0 without tooling or a nested lockfile', () => {
  const vendor = path.resolve(process.cwd(), 'vendor/omnibioai-design-tokens');
  const metadata = JSON.parse(fs.readFileSync(path.join(vendor, 'package.json'), 'utf8'));
  expect(metadata.version).toBe('1.1.0');
  expect(metadata.scripts).toBeUndefined();
  expect(metadata.devDependencies).toBeUndefined();
  expect(fs.existsSync(path.join(vendor, 'package-lock.json'))).toBe(false);
  expect(fs.readFileSync(path.resolve(process.cwd(), 'src/vendor/omnibioai-design-tokens.css'), 'utf8'))
    .toBe(fs.readFileSync(path.join(vendor, 'tokens.css'), 'utf8'));
});

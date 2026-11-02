// Studio publishes the IDEs to browsers only through its router's same-origin
// /jupyter/, /rstudio/ and /vscode/ locations (omnibioai-studio
// docker/nginx-router.conf; its own Services page opens the same paths). The
// raw container ports (8888/8787/8083) are bound to loopback in production, and
// an http://<host>:<port> link from https://webstudio.omnibioai.org is either
// unreachable or blocked as mixed content.
//
// Launcher is served on that same origin under /_svc/sdk, so the page origin is
// the right default. REACT_APP_IDE_BASE_URL overrides it for deployments where
// the router lives elsewhere (e.g. opening Launcher directly on port 5190). It
// is a public URL, never a credential.
const IDE_PATHS = Object.freeze({
  jupyterlab: '/jupyter/',
  rstudio: '/rstudio/',
  vscode: '/vscode/',
  // Terminal is VS Code Server's integrated terminal in the same container.
  terminal: '/vscode/',
});

export function ideBaseUrl(configured = process.env.REACT_APP_IDE_BASE_URL, origin = window.location.origin) {
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === 'https:' || url.protocol === 'http:') return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
    } catch { /* fall through to the page origin */ }
  }
  return origin;
}

export function ideUrl(ide, { query, base = ideBaseUrl() } = {}) {
  const path = IDE_PATHS[ide];
  if (!path) return null;
  const search = query ? `?${new URLSearchParams(query)}` : '';
  return `${base}${path}${search}`;
}

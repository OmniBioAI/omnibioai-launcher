// Browser auth for the Launcher UI: the signed-in user's own OmniBioAI access
// token, never a credential compiled into the bundle.
//
// Create React App inlines every REACT_APP_* variable into public JavaScript, so
// a reusable secret (a Jupyter token, an API bearer) passed through one is
// readable by anyone who can download the bundle -- that is exactly how this
// UI once published its Jupyter token. The token here comes from the platform's
// standard session store (omnibioai_access_token, set by the host app); it is
// sent only if present, and the API verifies it server-side.
export const ACCESS_TOKEN_KEY = 'omnibioai_access_token';

export function accessToken() {
  try {
    return window.localStorage.getItem(ACCESS_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function authHeaders(extra = {}) {
  const token = accessToken();
  return token ? { Authorization: `Bearer ${token}`, ...extra } : { ...extra };
}

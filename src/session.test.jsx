import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { ACCESS_TOKEN_KEY, accessToken, authHeaders } from './session';
import IdeCard from './components/IdeCard';

// The Launcher once compiled its Jupyter token and an API bearer into the public
// bundle (REACT_APP_*). It now sends only the signed-in user's own token, and
// only if one exists. The sentinel is synthetic.
const SENTINEL = 'OMNIBIOAI_TEST_SECRET_DO_NOT_SHIP';

describe('browser session auth', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => jest.restoreAllMocks());

  test('sends the signed-in user\'s own token', () => {
    window.localStorage.setItem(ACCESS_TOKEN_KEY, 'user-iam-token');
    expect(accessToken()).toBe('user-iam-token');
    expect(authHeaders()).toEqual({ Authorization: 'Bearer user-iam-token' });
    expect(authHeaders({ 'Content-Type': 'application/json' })).toEqual({
      Authorization: 'Bearer user-iam-token', 'Content-Type': 'application/json',
    });
  });

  test('sends no Authorization header at all when signed out (never a placeholder)', () => {
    expect(accessToken()).toBeNull();
    expect(authHeaders()).toEqual({});
    expect(authHeaders({ 'Content-Type': 'application/json' })).toEqual({ 'Content-Type': 'application/json' });
  });

  test('fails closed when storage is unavailable', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(accessToken()).toBeNull();
    expect(authHeaders()).toEqual({});
  });

  test('IdeCard requests carry the user token, never a build-time credential', async () => {
    process.env.REACT_APP_JUPYTER_TOKEN = SENTINEL;
    process.env.REACT_APP_OMNIBIOAI_TOKEN = SENTINEL;
    window.localStorage.setItem(ACCESS_TOKEN_KEY, 'user-iam-token');
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'stopped' }) });
    try {
      render(<IdeCard tool="jupyter" />);
      await waitFor(() => expect(global.fetch).toHaveBeenCalled());
      const [, init] = global.fetch.mock.calls[0];
      expect(init.headers).toEqual({ Authorization: 'Bearer user-iam-token' });
      expect(JSON.stringify(global.fetch.mock.calls)).not.toContain(SENTINEL);
    } finally {
      delete process.env.REACT_APP_JUPYTER_TOKEN;
      delete process.env.REACT_APP_OMNIBIOAI_TOKEN;
    }
  });

  test('IdeCard sends no Authorization header when signed out', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'stopped' }) });
    render(<IdeCard tool="jupyter" />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(global.fetch.mock.calls[0][1].headers).toEqual({});
  });
});

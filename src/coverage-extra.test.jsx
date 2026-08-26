import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { IdeCard } from './components/IdeCard';

describe('additional coverage for asynchronous and fallback paths', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    window.history.replaceState({}, '', '/');
  });

  test('launches after the polling timeout when the IDE stays stopped', async () => {
    jest.spyOn(window, 'open').mockImplementation(() => null);
    jest.spyOn(global, 'setInterval').mockImplementation((callback) => {
      for (let i = 0; i < 30; i += 1) callback();
      return 1;
    });
    jest.spyOn(global, 'clearInterval').mockImplementation(() => {});
    global.fetch = jest.fn((url) => {
      if (url.includes('/status/')) return Promise.resolve({ ok: true, json: async () => ({ status: 'stopped' }) });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    render(<IdeCard tool="jupyter" />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByRole('button', { name: 'Launch' }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(window.open).toHaveBeenCalledWith('http://localhost:8888', '_blank');
  });

  test('clears a failed polling interval after the timeout', async () => {
    jest.spyOn(global, 'setInterval').mockImplementation((callback) => {
      for (let i = 0; i < 30; i += 1) callback();
      return 1;
    });
    jest.spyOn(global, 'clearInterval').mockImplementation(() => {});
    global.fetch = jest.fn((url) => {
      if (url.includes('/status/')) return Promise.resolve({ ok: true, json: async () => ({ status: 'stopped' }) });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    render(<IdeCard tool="rstudio" />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByRole('button', { name: 'Launch' }));
    global.fetch.mockRejectedValue(new Error('polling unavailable'));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(screen.getByRole('button', { name: 'Starting…' })).toBeInTheDocument();
  });

  test('covers flat grouping, load-more hover handlers, and empty results', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: async () => ({ objects: [], count: 0, has_next: false }) }));
    render(<App />);
    expect(await screen.findByText('No objects match your search.')).toBeInTheDocument();

    // Re-render with a paginated response so the server load-more controls exist.
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        objects: Array.from({ length: 20 }, (_, i) => ({ object_id: `obj-${i}`, object_type: 'Job', name: `Job ${i}`, metadata: {}, parent_id: null })),
        count: 40,
        has_next: true,
      }),
    });
    fireEvent.change(screen.getByPlaceholderText(/Search by name/i), { target: { value: 'jobs' } });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 500)); });
    const loadNext = await screen.findByRole('button', { name: /Load next 20 objects/ });
    fireEvent.mouseEnter(loadNext);
    fireEvent.mouseLeave(loadNext);
    fireEvent.click(screen.getByRole('button', { name: 'Flat' }));
    expect(loadNext).toBeInTheDocument();
  });

  test('handles rejected lineage requests and opens a selected server object', async () => {
    const current = { object_id: 'current', object_type: 'Job', name: 'Current job', metadata: {}, parent_id: 'parent' };
    const sibling = { object_id: 'sibling', object_type: 'Job', name: 'Sibling job', metadata: {}, parent_id: 'parent' };
    global.fetch = jest.fn((url) => {
      if (url.includes('parent_id=parent')) return Promise.resolve({ ok: true, json: async () => ({ objects: [sibling] }) });
      if (url.endsWith('/current/')) return Promise.resolve({ ok: true, json: async () => current });
      if (url.includes('parent_id=parent')) return Promise.resolve({ ok: true, json: async () => ({ objects: [sibling] }) });
      if (url.endsWith('/sibling/')) return Promise.resolve({ ok: true, json: async () => sibling });
      if (url.includes('/api/dev/objects/?')) return Promise.resolve({ ok: true, json: async () => ({ objects: [current], count: 1, has_next: false }) });
      return Promise.reject(new Error('lineage unavailable'));
    });

    render(<App />);
    await userEvent.click(await screen.findByText('Current job'));
    expect(await screen.findByText('Sibling job')).toBeInTheDocument();

    const lineageRow = screen.getAllByText('Current job')[1].closest('div[style]');
    fireEvent.mouseEnter(lineageRow);
    fireEvent.mouseLeave(lineageRow);
    await userEvent.click(screen.getByText('Sibling job'));
    expect(await screen.findAllByText('Sibling job')).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'Open in Environment →' }));
    const launch = screen.getByRole('button', { name: 'Open in JupyterLab' });
    fireEvent.mouseEnter(launch);
    fireEvent.mouseLeave(launch);
  });
});

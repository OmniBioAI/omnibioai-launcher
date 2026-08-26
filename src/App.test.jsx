import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

const object = {
  object_id: 'obj-1',
  object_type: 'Study',
  name: 'Example study',
  metadata: { status: 'done', samples: 4, log_tail: Array.from({ length: 10 }, (_, i) => `[INFO] line ${i}`), progress: 100 },
  parent_id: null,
};
const child = { object_id: 'child-1', object_type: 'Job', name: 'Example job', metadata: { status: 'running' }, parent_id: 'obj-1' };

function installFetch() {
  global.fetch = jest.fn((url) => {
    if (url.includes('/api/dev/objects/?')) return Promise.resolve({ ok: true, json: async () => ({ objects: [object, child], count: 2, has_next: false }) });
    if (url.includes('/api/dev/objects/')) return Promise.resolve({ ok: true, json: async () => object });
    return Promise.reject(new Error('unexpected URL'));
  });
}

describe('App', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
    installFetch();
    jest.spyOn(window.parent, 'postMessage').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  test('loads the object list, filters/groups it, and opens details', async () => {
    render(<App />);
    expect(screen.getByText('Loading objects…')).toBeInTheDocument();
    expect(await screen.findAllByText('Example study')).toHaveLength(2);
    expect(screen.getByText('By study')).toBeInTheDocument();
    expect(screen.getByText('Example job')).toBeInTheDocument();
    fireEvent.mouseEnter(screen.getAllByText('Example study')[1].parentElement.parentElement);
    fireEvent.mouseLeave(screen.getAllByText('Example study')[1].parentElement.parentElement);

    await userEvent.type(screen.getByPlaceholderText(/Search by name/i), 'Example');
    await userEvent.selectOptions(screen.getByRole('combobox'), 'Job');
    await userEvent.click(screen.getByRole('button', { name: 'By type' }));
    await userEvent.click(screen.getAllByText('Example study').at(-1));
    expect(await screen.findByRole('heading', { name: 'Example study' })).toBeInTheDocument();
    expect(screen.getByText('Metadata')).toBeInTheDocument();
    expect(screen.getByText('Job Log')).toBeInTheDocument();
  });

  test('handles detail lineage, log expansion, launch navigation, and back navigation', async () => {
    render(<App />);
    await screen.findAllByText('Example study');
    await userEvent.click(screen.getAllByText('Example study').at(-1));
    expect(await screen.findByText('↓ Children')).toBeInTheDocument();
    expect(screen.getByText('… 2 earlier lines hidden')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '▼ Show full log' }));
    expect(screen.getByText('[INFO] line 0')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open in Environment →' }));
    expect(screen.getByText('Open in environment')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Notebook JupyterLab/ }));
    fireEvent.mouseLeave(screen.getByRole('button', { name: 'Open in JupyterLab' }));
    await userEvent.click(screen.getByRole('button', { name: 'Open in JupyterLab' }));
    await userEvent.click(screen.getByRole('button', { name: '← Back' }));
    expect(await screen.findAllByText('Example study')).toHaveLength(2);
  });

  test('shows API errors and supports environment launch fallback messaging', async () => {
    global.fetch.mockImplementationOnce(() => Promise.reject(new Error('network down')));
    render(<App />);
    expect(await screen.findAllByText('Alzheimer CaseStudy')).toHaveLength(2);

    cleanup();
    window.history.replaceState({}, '', '/?object_id=test');
    render(<App />);
    expect(await screen.findByText('TCGA-BRCA RNAseq cohort 2024')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /R \/ RStudio Open RStudio/ }));
    expect(window.parent.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'open-external', url: expect.stringContaining(':8787') }), '*'
    );

    cleanup();
    window.history.replaceState({}, '', '/?object_id=real-ok');
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ ...object, object_id: 'real-ok' }) });
    render(<App />);
    expect(await screen.findByText('Example study')).toBeInTheDocument();
  });

  test('uses Electron IPC when available and downloads the R starter script', async () => {
    window.history.replaceState({}, '', '/?object_id=test');
    const sendToHost = jest.fn();
    window.require = jest.fn(() => ({ ipcRenderer: { sendToHost } }));
    const createObjectURL = jest.fn(() => 'blob:test');
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = jest.fn();
    const click = jest.fn();
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(click);
    render(<App />);
    expect(await screen.findByText('TCGA-BRCA RNAseq cohort 2024')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /R \/ RStudio Open RStudio/ }));
    expect(sendToHost).toHaveBeenCalledWith('open-external', expect.stringContaining(':8787'));
    await userEvent.click(screen.getByRole('button', { name: 'Download R starter script' }));
    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    delete window.require;
  });

  test('renders server pagination, exercises grouping modes, collapse, and local group pagination', async () => {
    const manyObjects = Array.from({ length: 25 }, (_, i) => ({
      object_id: `item-${i}`, object_type: i % 2 ? 'Job' : 'Study', name: `Item ${i}`, metadata: {}, parent_id: null,
    }));
    global.fetch.mockImplementation((url) => {
      if (url.includes('page=2')) return Promise.resolve({ ok: true, json: async () => ({ objects: [], count: 25, has_next: false }) });
      return Promise.resolve({ ok: true, json: async () => ({ objects: manyObjects, count: 50, has_next: true }) });
    });
    render(<App />);
    expect(await screen.findByText('Item 24')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'By type' }));
    await userEvent.click(screen.getAllByText('Job')[1]);
    await userEvent.click(screen.getByRole('button', { name: 'Flat' }));
    await userEvent.click(screen.getByRole('button', { name: /Load 5 more/ }));
    await userEvent.click(screen.getByRole('button', { name: /Load next 20 objects/ }));
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('page=2'), expect.any(Object));
    await userEvent.click(screen.getByText('Flat').closest('div').previousSibling || screen.getByText('Flat'));
  });

  test('loads an object error and handles parent/sibling/child lineage and navigation', async () => {
    cleanup();
    window.history.replaceState({}, '', '/');
    const parent = { object_id: 'parent-1', object_type: 'Study', name: 'Parent', metadata: {}, parent_id: null };
    const current = { ...child, parent_id: 'parent-1', inputs: ['input-1'], metadata: { progress: 42, log_tail: ['[ERROR] bad', '[WARN] caution', '[OK] fixed', '[DONE] done', 'plain'] } };
    const sibling = { object_id: 'sibling-1', object_type: 'Job', name: 'Sibling', metadata: {}, parent_id: 'parent-1' };
    const childOfCurrent = { object_id: 'grandchild-1', object_type: 'Result', name: 'Grandchild', metadata: {}, parent_id: 'child-1' };
    global.fetch.mockImplementation((url) => {
      if (url.includes('parent_id=child-1')) return Promise.resolve({ ok: true, json: async () => ({ objects: [childOfCurrent] }) });
      if (url.includes('parent_id=parent-1')) return Promise.resolve({ ok: true, json: async () => ({ objects: [parent, sibling] }) });
      if (url.endsWith('/parent-1/')) return Promise.resolve({ ok: true, json: async () => parent });
      if (url.endsWith('/child-1/')) return Promise.resolve({ ok: true, json: async () => current });
      if (url.includes('/api/dev/objects/?')) return Promise.resolve({ ok: true, json: async () => ({ objects: [current], count: 1, has_next: false }) });
      return Promise.reject(new Error('not found'));
    });
    render(<App />);
    expect(await screen.findByText('Example job')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Example job'));
    expect(await screen.findByText('↑ Parent')).toBeInTheDocument();
    expect(screen.getByText('↔ Siblings')).toBeInTheDocument();
    expect(screen.getByText('↓ Children')).toBeInTheDocument();
    await userEvent.click(screen.getByText('input-1'));
    await userEvent.click(screen.getByText('Sibling'));
    expect(await screen.findAllByText('Example job')).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: '← Back' }));
    expect(await screen.findByText('Example job')).toBeInTheDocument();
  });

  test('shows object loading errors and uses the browser launch branches', async () => {
    cleanup();
    window.history.replaceState({}, '', '/?object_id=real-id');
    global.fetch.mockRejectedValue(new Error('HTTP 503'));
    render(<App />);
    expect(await screen.findByText('Error loading object: HTTP 503')).toBeInTheDocument();
    cleanup();
    window.history.replaceState({}, '', '/?object_id=test');
    global.fetch.mockResolvedValue({ ok: true, json: async () => object });
    const open = jest.spyOn(window.parent, 'postMessage').mockImplementation(() => {});
    render(<App />);
    expect(await screen.findByText('TCGA-BRCA RNAseq cohort 2024')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /VS Code Open VS Code/ }));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining(':8083') }), '*');

    cleanup();
    window.history.replaceState({}, '', '/?object_id=test');
    window.require = jest.fn(() => { throw new Error('not electron'); });
    global.fetch.mockResolvedValue({ ok: true, json: async () => object });
    render(<App />);
    expect(await screen.findByText('TCGA-BRCA RNAseq cohort 2024')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /VS Code Open VS Code/ }));
    expect(open).toHaveBeenCalled();
    delete window.require;
  });
});

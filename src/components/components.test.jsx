import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import EnvCard from './EnvCard';
import InstallModal from './InstallModal';
import ObjectCard from './ObjectCard';
import Toast from './Toast';

describe('presentational launcher components', () => {
  afterEach(() => jest.useRealTimers());
  test('ObjectCard renders its fallback name and metadata values', () => {
    const { rerender } = render(<ObjectCard obj={{ object_type: 'Sample' }} objectId="id-1" />);
    expect(screen.getByText('Sample')).toBeInTheDocument();
    expect(screen.getByText('id-1')).toBeInTheDocument();

    rerender(<ObjectCard obj={{ name: 'Study', metadata: { count: 3, nested: { ok: true } } }} objectId="id-2" />);
    expect(screen.getByText('Study')).toBeInTheDocument();
    expect(screen.getByText('count')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('[object Object]')).toBeInTheDocument();
  });

  test('EnvCard reports mouse and keyboard activation and selected state', () => {
    const onClick = jest.fn();
    const { rerender } = render(
      <EnvCard type="notebook" title="Notebook" description="desc" selected={false} onClick={onClick} />
    );
    const card = screen.getByRole('button', { name: /Notebook desc Ready/i });
    fireEvent.click(card);
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(onClick).toHaveBeenCalledTimes(2);
    rerender(<EnvCard type="unknown" title="Other" description="x" selected onClick={onClick} />);
    expect(screen.getByRole('button', { name: /Other x Ready/i })).toHaveClass('env-card--selected');
  });

  test('InstallModal dismisses by escape, button, overlay, and supports direct launch', () => {
    const onDismiss = jest.fn();
    const open = jest.spyOn(window, 'open').mockImplementation(() => null);
    render(<InstallModal type="vscode" onDismiss={onDismiss} />);
    expect(screen.getByText('VS Code not detected')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download VS Code' })).toHaveAttribute(
      'href', 'https://code.visualstudio.com/download'
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    fireEvent.click(screen.getByRole('button', { name: 'Try opening directly' }));
    fireEvent.click(document.querySelector('.modal-overlay'));
    expect(onDismiss).toHaveBeenCalledTimes(3);
    expect(open).toHaveBeenCalledWith('vscode://', '_blank');
    open.mockRestore();
  });

  test('Toast becomes visible and cleans up its timers', () => {
    jest.useFakeTimers();
    window.requestAnimationFrame = (callback) => { callback(); return 1; };
    render(<Toast message="Saved" />);
    expect(screen.getByText('Saved')).toHaveClass('toast--visible');
    act(() => jest.advanceTimersByTime(2600));
    expect(screen.getByText('Saved')).not.toHaveClass('toast--visible');
    jest.useRealTimers();
  });

});

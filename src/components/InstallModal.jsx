import React, { useEffect } from 'react';

const CONFIGS = {
  vscode: {
    title: 'VS Code not detected',
    body: "It looks like VS Code isn't installed, or your browser blocked the launch. You can still use the copied env vars in any terminal.",
    primaryLabel: 'Download VS Code',
    primaryUrl: 'https://code.visualstudio.com/download',
    directUrl: 'vscode://',
    note: "If the app is installed but didn't open, try clicking the button below directly.",
  },
  rstudio: {
    title: 'RStudio not detected',
    body: "It looks like RStudio isn't installed, or your browser blocked the launch. Your R script has been downloaded — open it in RStudio once installed.",
    primaryLabel: 'Download RStudio',
    primaryUrl: 'https://posit.co/download/rstudio-desktop/',
    directUrl: 'rstudio://',
    note: "If the app is installed but didn't open, try clicking the button below directly.",
  },
};

function InstallModal({ type, onDismiss }) {
  const config = CONFIGS[type];

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onDismiss(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  return (
    <div className="modal-overlay" onClick={onDismiss}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="install-modal-title" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal-title" id="install-modal-title">{config.title}</h2>
        <p className="modal-body">{config.body}</p>
        <div className="modal-actions">
          <a
            className="modal-btn-primary"
            href={config.primaryUrl}
            target="_blank"
            rel="noreferrer"
          >
            {config.primaryLabel}
          </a>
          <button className="modal-btn-secondary" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
        <p className="modal-note">{config.note}</p>
        <button
          className="modal-btn-direct"
          onClick={() => window.open(config.directUrl, '_blank')}
        >
          Try opening directly
        </button>
      </div>
    </div>
  );
}

export default InstallModal;

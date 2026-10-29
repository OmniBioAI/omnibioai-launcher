import React from 'react';

const ICON_BG = {
  notebook: '#2a1800',
  vscode:   '#0d1a2e',
  r:        '#0a2a1a',
};

function NotebookIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="3" y="2" width="14" height="18" rx="2" stroke="#ea580c" strokeWidth="1.5" />
      <line x1="6" y1="7" x2="14" y2="7" stroke="#ea580c" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="6" y1="11" x2="14" y2="11" stroke="#ea580c" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="6" y1="15" x2="10" y2="15" stroke="#ea580c" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function VSCodeIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M15.5 2.5L9 8.5L4.5 5.5L2.5 7L7 11L2.5 15L4.5 16.5L9 13.5L15.5 19.5L19.5 17.5V4.5L15.5 2.5Z"
        fill="#007ACC"
      />
      <path
        d="M15.5 6.5L11 11L15.5 15.5V6.5Z"
        fill="white"
        fillOpacity="0.75"
      />
    </svg>
  );
}

function RIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg">
      <text x="3" y="17" fontFamily="serif" fontSize="18" fontWeight="bold" fill="#16a34a">R</text>
    </svg>
  );
}

const ICONS = {
  notebook: <NotebookIcon />,
  vscode:   <VSCodeIcon />,
  r:        <RIcon />,
};

function EnvCard({ type, title, description, selected, onClick }) {
  return (
    <div
      className={`env-card${selected ? ' env-card--selected' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
    >
      <div className="env-icon" style={{ background: ICON_BG[type] }} aria-hidden="true">
        {ICONS[type]}
      </div>
      <div className="env-title">{title}</div>
      <div className="env-desc">{description}</div>
      <span className="env-badge">Ready</span>
    </div>
  );
}

export default EnvCard;

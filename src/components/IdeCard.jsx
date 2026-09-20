import React, { useState, useEffect, useCallback } from 'react';
import { authHeaders } from '../session';

const BASE_URL = process.env.REACT_APP_OMNIBIOAI_BASE_URL || 'http://127.0.0.1:8000';

const IDE_CONFIG = {
  jupyter: {
    title: 'JupyterLab',
    description: 'Interactive notebooks with full bioinformatics stack',
    url: 'http://localhost:8888',
    iconBg: '#2a1800',
    accentColor: '#f97316',
    Icon: JupyterIcon,
  },
  rstudio: {
    title: 'RStudio',
    description: 'R environment with Bioconductor & Seurat',
    url: 'http://localhost:8787',
    iconBg: '#0a1a2a',
    accentColor: '#0094ff',
    Icon: RStudioIcon,
  },
  vscode: {
    title: 'VS Code',
    description: 'Code editor with Python, R & workflow extensions',
    url: 'http://localhost:8080',
    iconBg: '#0d1a2e',
    accentColor: '#007acc',
    Icon: VSCodeServerIcon,
  },
};

function JupyterIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="11" cy="11" r="8" stroke="#f97316" strokeWidth="1.5" />
      <ellipse cx="11" cy="11" rx="5" ry="3" stroke="#f97316" strokeWidth="1.2" />
      <circle cx="11" cy="4.5" r="1.2" fill="#f97316" />
      <circle cx="16.5" cy="14.5" r="1.2" fill="#f97316" />
      <circle cx="5.5" cy="14.5" r="1.2" fill="#f97316" />
    </svg>
  );
}

function RStudioIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="18" height="18" rx="3" stroke="#0094ff" strokeWidth="1.5" fill="none" />
      <text x="4" y="16" fontFamily="serif" fontSize="14" fontWeight="bold" fill="#0094ff">R</text>
    </svg>
  );
}

function VSCodeServerIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M15.5 2.5L9 8.5L4.5 5.5L2.5 7L7 11L2.5 15L4.5 16.5L9 13.5L15.5 19.5L19.5 17.5V4.5L15.5 2.5Z"
        fill="#007ACC"
      />
      <path d="M15.5 6.5L11 11L15.5 15.5V6.5Z" fill="white" fillOpacity="0.75" />
    </svg>
  );
}

const STATUS_STYLES = {
  running:  { dot: '#00e5a0', label: 'Running',  bg: '#0a2a1a', border: '#1a4a2a' },
  starting: { dot: '#f59e0b', label: 'Starting…', bg: '#2a1800', border: '#4a2e00' },
  stopped:  { dot: '#6b7280', label: 'Stopped',  bg: '#1a1d2e', border: '#2a2d3e' },
  error:    { dot: '#ef4444', label: 'Error',    bg: '#2a0f0f', border: '#4a1f1f' },
};

function StatusBadge({ status }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES.stopped;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 600,
      background: s.bg, border: `1px solid ${s.border}`, color: s.dot,
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%', background: s.dot,
        animation: status === 'starting' ? 'pulse 1.2s ease-in-out infinite' : 'none',
      }} />
      {s.label}
    </span>
  );
}

export function IdeCard({ tool }) {
  const config = IDE_CONFIG[tool];
  const [status, setStatus] = useState('stopped');
  const [hovered, setHovered] = useState(false);
  const [actionPending, setActionPending] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch(`${BASE_URL}/api/launcher/status/${tool}`, {
        headers: authHeaders(),
      });
      if (r.ok) {
        const data = await r.json();
        setStatus(data.status ?? 'stopped');
      }
    } catch {
      // backend unavailable — keep last known status
    }
  }, [tool]);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const handleLaunch = async () => {
    if (status === 'running') {
      window.open(config.url, '_blank');
      return;
    }

    setActionPending(true);
    setStatus('starting');

    try {
      await fetch(`${BASE_URL}/api/launcher/start/${tool}`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
      });
    } catch {
      // best-effort — status polling will reconcile
    }

    // poll until running or timeout (30s)
    let attempts = 0;
    const poll = setInterval(async () => {
      attempts++;
      await fetchStatus();
      // fetchStatus updates status state; check via local fetch
      try {
        const r = await fetch(`${BASE_URL}/api/launcher/status/${tool}`, {
          headers: authHeaders(),
        });
        if (r.ok) {
          const data = await r.json();
          if (data.status === 'running') {
            clearInterval(poll);
            setActionPending(false);
            window.open(config.url, '_blank');
          } else if (attempts >= 30) {
            clearInterval(poll);
            setActionPending(false);
            window.open(config.url, '_blank');
          }
        }
      } catch {
        if (attempts >= 30) { clearInterval(poll); setActionPending(false); }
      }
    }, 1000);
  };

  const handleStop = async (e) => {
    e.stopPropagation();
    setActionPending(true);
    try {
      await fetch(`${BASE_URL}/api/launcher/stop/${tool}`, {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
      });
      setStatus('stopped');
    } catch {
      // best-effort
    }
    setActionPending(false);
  };

  const { Icon, accentColor, iconBg } = config;
  const isRunning = status === 'running';

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? '#1f2340' : '#1a1d2e',
        border: `1px solid ${hovered ? accentColor : '#2a2d3e'}`,
        borderRadius: 10,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        transition: 'border-color 0.15s, background 0.15s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{
          width: 36, height: 36, borderRadius: 8,
          background: iconBg,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon />
        </div>
        <StatusBadge status={status} />
      </div>

      <div>
        <div style={{ fontWeight: 600, fontSize: 14, color: '#ffffff' }}>{config.title}</div>
        <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.4, marginTop: 2 }}>
          {config.description}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        <button
          onClick={handleLaunch}
          disabled={actionPending}
          style={{
            flex: 1,
            padding: '7px 0',
            borderRadius: 6,
            border: 'none',
            fontSize: 12,
            fontWeight: 600,
            cursor: actionPending ? 'default' : 'pointer',
            background: isRunning ? accentColor : '#2a2d3e',
            color: isRunning ? '#0f1117' : '#ffffff',
            opacity: actionPending ? 0.7 : 1,
            transition: 'background 0.15s, opacity 0.15s',
          }}
        >
          {status === 'starting' ? 'Starting…' : isRunning ? 'Open' : 'Launch'}
        </button>

        {isRunning && (
          <button
            onClick={handleStop}
            disabled={actionPending}
            style={{
              padding: '7px 10px',
              borderRadius: 6,
              border: '1px solid #2a2d3e',
              fontSize: 12,
              cursor: actionPending ? 'default' : 'pointer',
              background: 'transparent',
              color: '#6b7280',
              transition: 'border-color 0.15s, color 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#ef4444'; e.currentTarget.style.color = '#ef4444'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#2a2d3e'; e.currentTarget.style.color = '#6b7280'; }}
          >
            Stop
          </button>
        )}
      </div>
    </div>
  );
}

export default IdeCard;

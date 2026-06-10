import React, { useState, useEffect, useMemo, useCallback } from 'react';
import './App.css';
import ObjectCard from './components/ObjectCard';
import EnvCard from './components/EnvCard';
import Toast from './components/Toast';
import InstallModal from './components/InstallModal';

const BASE_URL = process.env.REACT_APP_OMNIBIOAI_BASE_URL || 'http://127.0.0.1:8000';
const TOKEN = process.env.REACT_APP_OMNIBIOAI_TOKEN || 'dev';
const JUPYTER_BASE = process.env.REACT_APP_JUPYTER_BASE || 'http://127.0.0.1:8890';
const JUPYTER_TOKEN = process.env.REACT_APP_JUPYTER_TOKEN || 'devtoken';
const USE_MOCK = process.env.REACT_APP_USE_MOCK === 'true';
const PAGE_SIZE = 20;

// ── Mock data ─────────────────────────────────────────────────────────
const MOCK_OBJECT = {
  object_id: 'test-1234-abcd-5678',
  name: 'TCGA-BRCA RNAseq cohort 2024',
  object_type: 'RNASeqObject',
  metadata: { samples: 1247, genome: 'hg38', platform: 'Illumina NovaSeq', created_by: 'manish' },
};

const MOCK_REGISTRY = {
  'test-1234-abcd-5678': { ...MOCK_OBJECT, parent_id: null },
  '56d3fc3a-709b-4ed0-bf17-8cb73c6746b0': {
    object_id: '56d3fc3a-709b-4ed0-bf17-8cb73c6746b0',
    object_type: 'LiteratureStudy', name: 'Alzheimer CaseStudy',
    metadata: { study: 'Alzheimer_CaseStudy', status: 'created' }, parent_id: null,
  },
  '673590e8-fd26-4f8b-99cf-ddbf79d4bcd9': {
    object_id: '673590e8-fd26-4f8b-99cf-ddbf79d4bcd9',
    object_type: 'LiteratureJob', name: 'Alzheimer Ingest Job',
    metadata: { kind: 'ingest', status: 'done' },
    parent_id: '56d3fc3a-709b-4ed0-bf17-8cb73c6746b0',
  },
  'dadb78b0-348f-4056-b9f6-c870abb00455': {
    object_id: 'dadb78b0-348f-4056-b9f6-c870abb00455',
    object_type: 'LiteratureJob', name: 'Alzheimer Embedding Job',
    metadata: { kind: 'embed', status: 'done' },
    parent_id: '56d3fc3a-709b-4ed0-bf17-8cb73c6746b0',
  },
  '0cd22aa4-7d03-4851-8136-0da11318188b': {
    object_id: '0cd22aa4-7d03-4851-8136-0da11318188b',
    object_type: 'LiteratureSummary', name: 'Amyloid Therapy Summary',
    metadata: { status: 'done', query: 'Which therapies target amyloid pathways?' },
    parent_id: '56d3fc3a-709b-4ed0-bf17-8cb73c6746b0',
  },
  'f07c1ee1-0095-4c30-81aa-185c89c7bc43': {
    object_id: 'f07c1ee1-0095-4c30-81aa-185c89c7bc43',
    object_type: 'LiteratureJob', name: 'Alzheimer RAG Job',
    metadata: { kind: 'rag', status: 'done' },
    parent_id: '56d3fc3a-709b-4ed0-bf17-8cb73c6746b0',
  },
};

// ── Styling helpers ───────────────────────────────────────────────────
const TYPE_COLORS = {
  LiteratureStudy:   { bg: '#0d2137', text: '#0094ff', border: '#1a3a5c' },
  LiteratureJob:     { bg: '#2a1800', text: '#f59e0b', border: '#4a2e00' },
  LiteratureSummary: { bg: '#0a2a1a', text: '#00e5a0', border: '#1a4a2a' },
  RNASeqObject:      { bg: '#1f0a2a', text: '#a855f7', border: '#3d1a52' },
  default:           { bg: '#1a1d2e', text: '#6b7280', border: '#2a2d3e' },
};

function typeBadge(objectType) {
  const c = TYPE_COLORS[objectType] || TYPE_COLORS.default;
  return {
    display: 'inline-block', padding: '2px 8px', borderRadius: 4,
    fontSize: 11, fontWeight: 600, letterSpacing: '0.3px',
    background: c.bg, color: c.text, border: `1px solid ${c.border}`,
    whiteSpace: 'nowrap',
  };
}

const STATUS_COLOR = { done: '#00e5a0', created: '#f59e0b', running: '#0094ff', failed: '#ef4444' };

function shouldUseMock(id) { return USE_MOCK || id === 'test'; }

const LAUNCH_LABELS = {
  notebook: 'Open in JupyterLab',
  vscode:   'Copy env vars to clipboard',
  r:        'Download R script + open RStudio',
};

// ── Group builder ─────────────────────────────────────────────────────
function buildGroups(objects, groupMode) {
  if (groupMode === 'flat') {
    return [{ groupKey: 'all', label: null, objects }];
  }

  if (groupMode === 'type') {
    const byType = {};
    objects.forEach((o) => {
      const t = o.object_type || 'Unknown';
      if (!byType[t]) byType[t] = [];
      byType[t].push(o);
    });
    return Object.entries(byType)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([t, objs]) => ({ groupKey: t, label: t, objects: objs }));
  }

  if (groupMode === 'study') {
    const byId = Object.fromEntries(objects.map((o) => [o.object_id, o]));
    const childrenMap = {};
    const roots = [];

    objects.forEach((o) => {
      const pid = o.parent_id;
      if (pid && byId[pid]) {
        if (!childrenMap[pid]) childrenMap[pid] = [];
        childrenMap[pid].push(o);
      } else {
        roots.push(o);
      }
    });

    const groups = [];
    const typeOrphans = {};

    roots.forEach((root) => {
      const kids = childrenMap[root.object_id] || [];
      if (kids.length > 0) {
        groups.push({
          groupKey: root.object_id,
          label: root.name || root.object_type,
          parentObj: root,
          objects: [root, ...kids],
        });
      } else {
        const t = root.object_type || 'Unknown';
        if (!typeOrphans[t]) typeOrphans[t] = [];
        typeOrphans[t].push(root);
      }
    });

    Object.entries(typeOrphans)
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([t, objs]) => {
        groups.push({ groupKey: `type-${t}`, label: t, objects: objs });
      });

    return groups;
  }

  return [{ groupKey: 'all', label: null, objects }];
}

// ── ObjectRow ─────────────────────────────────────────────────────────
function ObjectRow({ obj, onSelect, isChild }) {
  const [hovered, setHovered] = useState(false);
  const status = obj.metadata?.status;

  const metaPreview = obj.metadata
    ? Object.entries(obj.metadata)
        .filter(([k]) => !['status', 'log_tail', 'celery_id', 'citations', 'answer', 'progress'].includes(k))
        .slice(0, 3)
        .map(([k, v]) => `${k}: ${v}`)
        .join('  ·  ')
    : '';

  return (
    <div
      onClick={() => onSelect(obj)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: isChild ? '10px 16px 10px 32px' : '12px 16px',
        borderRadius: 10, cursor: 'pointer',
        border: hovered ? '1px solid #0094ff' : '1px solid #2a2d3e',
        background: hovered ? '#0d1e2e' : isChild ? '#131620' : '#1a1d2e',
        transition: 'border-color 0.15s, background 0.15s',
        boxShadow: hovered ? '0 1px 6px rgba(0,148,255,0.12)' : 'none',
        marginLeft: isChild ? 16 : 0,
        position: 'relative',
      }}
    >
      {isChild && (
        <div style={{
          position: 'absolute', left: 12, top: '50%',
          transform: 'translateY(-50%)',
          width: 10, height: 1, background: '#2a2d3e',
        }} />
      )}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 3 }}>
          <span style={{ fontWeight: 600, fontSize: 14, color: '#ffffff' }}>
            {obj.name || obj.object_type}
          </span>
          <span style={typeBadge(obj.object_type)}>{obj.object_type}</span>
          {status && (
            <span style={{ fontSize: 11, fontWeight: 500, color: STATUS_COLOR[status] || '#6b7280' }}>
              ● {status}
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: '#6b7280', fontFamily: 'monospace', marginBottom: metaPreview ? 2 : 0 }}>
          {obj.object_id}
        </div>
        {metaPreview && (
          <div style={{ fontSize: 12, color: '#6b7280' }}>{metaPreview}</div>
        )}
      </div>

      <div style={{
        marginLeft: 12, fontSize: 13, whiteSpace: 'nowrap', transition: 'color 0.15s',
        color: hovered ? '#00e5a0' : '#6b7280', fontWeight: hovered ? 600 : 400,
      }}>
        Open →
      </div>
    </div>
  );
}

// ── GroupSection ──────────────────────────────────────────────────────
function GroupSection({ group, onSelect, groupMode, page, onLoadMore }) {
  const { label, objects, parentObj } = group;
  const [collapsed, setCollapsed] = useState(false);
  const isStudyGroup = groupMode === 'study' && !!parentObj;

  const visibleObjects = objects.slice(0, page * PAGE_SIZE);
  const remaining = objects.length - visibleObjects.length;

  return (
    <div style={{ marginBottom: label ? 20 : 0 }}>
      {label && (
        <div
          onClick={() => setCollapsed((c) => !c)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '6px 4px', marginBottom: 8, cursor: 'pointer', userSelect: 'none',
          }}
        >
          <span style={{
            fontSize: 10, color: '#6b7280', display: 'inline-block',
            transition: 'transform 0.15s',
            transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
          }}>▾</span>

          {isStudyGroup ? (
            <>
              <span style={typeBadge(parentObj.object_type)}>{parentObj.object_type}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#ffffff' }}>{label}</span>
            </>
          ) : (
            <span style={{ fontSize: 13, fontWeight: 600, color: '#ffffff' }}>{label}</span>
          )}

          <span style={{
            fontSize: 11, color: '#6b7280', background: '#2a2d3e',
            borderRadius: 10, padding: '1px 7px',
          }}>
            {objects.length}
          </span>
        </div>
      )}

      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {visibleObjects.map((obj) => (
            <ObjectRow
              key={obj.object_id}
              obj={obj}
              onSelect={onSelect}
              isChild={isStudyGroup && obj.object_id !== parentObj?.object_id}
            />
          ))}

          {remaining > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); onLoadMore(); }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#00e5a0'; e.currentTarget.style.color = '#00e5a0'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#2a2d3e'; e.currentTarget.style.color = '#6b7280'; }}
              style={{
                marginTop: 2, padding: '9px 0', background: 'none',
                border: '1px dashed #2a2d3e', borderRadius: 8,
                fontSize: 13, color: '#6b7280', cursor: 'pointer', width: '100%',
                transition: 'border-color 0.15s, color 0.15s',
              }}
            >
              Load {Math.min(PAGE_SIZE, remaining)} more
              <span style={{ color: '#6b7280', marginLeft: 6, fontSize: 12 }}>
                ({remaining} remaining)
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── ObjectSelector ────────────────────────────────────────────────────
function ObjectSelector({ onSelect }) {
  const [allObjects, setAllObjects]   = useState([]);
  const [loading, setLoading]         = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch]           = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [typeFilter, setTypeFilter]   = useState('all');
  const [groupMode, setGroupMode]     = useState('study');
  const [groupPages, setGroupPages]   = useState({});
  const [serverPage, setServerPage]   = useState(1);
  const [serverTotal, setServerTotal] = useState(null);
  const [hasMore, setHasMore]         = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const fetchPage = useCallback((page, currentSearch, currentType, replace = false) => {
    if (USE_MOCK) {
      setAllObjects(Object.values(MOCK_REGISTRY));
      setLoading(false);
      return;
    }

    page === 1 ? setLoading(true) : setLoadingMore(true);

    const params = new URLSearchParams({ page, page_size: PAGE_SIZE });
    if (currentSearch) params.set('search', currentSearch);
    if (currentType && currentType !== 'all') params.set('type', currentType);

    fetch(`${BASE_URL}/api/dev/objects/?${params}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data) => {
        const incoming = Array.isArray(data.objects) ? data.objects
          : Array.isArray(data) ? data
          : data?.results ?? [];
        setAllObjects((prev) => replace ? incoming : [...prev, ...incoming]);
        setServerTotal(data.count ?? null);
        setHasMore(data.has_next ?? false);
        setServerPage(page);
      })
      .catch(() => { if (replace) setAllObjects(Object.values(MOCK_REGISTRY)); })
      .finally(() => { setLoading(false); setLoadingMore(false); });
  }, []);

  useEffect(() => {
    setGroupPages({});
    fetchPage(1, search, typeFilter, true);
  }, [search, typeFilter, fetchPage]);

  const handleLoadMoreFromServer = useCallback(() => {
    if (!loadingMore && hasMore) fetchPage(serverPage + 1, search, typeFilter, false);
  }, [loadingMore, hasMore, serverPage, search, typeFilter, fetchPage]);

  const groups = useMemo(() => buildGroups(allObjects, groupMode), [allObjects, groupMode]);

  const types = useMemo(
    () => ['all', ...Array.from(new Set(allObjects.map((o) => o.object_type))).sort()],
    [allObjects]
  );

  const getPage = useCallback((key) => groupPages[key] || 1, [groupPages]);
  const loadMoreGroup = useCallback((key) => {
    setGroupPages((prev) => ({ ...prev, [key]: (prev[key] || 1) + 1 }));
  }, []);

  useEffect(() => { setGroupPages({}); }, [search, typeFilter, groupMode]);

  const totalShown = groups.reduce(
    (sum, g) => sum + Math.min(g.objects.length, getPage(g.groupKey) * PAGE_SIZE), 0
  );

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '0 16px 60px' }}>
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '20px 0', borderBottom: '1px solid #2a2d3e', marginBottom: 20,
      }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 20, color: '#ffffff', letterSpacing: '-0.3px' }}>
            OmniBioAI SDK
          </div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>Analysis Launcher</div>
        </div>
        <div style={{ fontSize: 12, color: '#6b7280', textAlign: 'right' }}>
          {serverTotal !== null
            ? <div>{serverTotal} objects in registry</div>
            : <div>{allObjects.length} loaded</div>}
          {totalShown < allObjects.length && (
            <div style={{ marginTop: 2, color: '#6b7280' }}>showing {totalShown} of {allObjects.length}</div>
          )}
        </div>
      </header>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Search by name, type, or ID…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          style={{
            flex: 1, minWidth: 180, height: 36, padding: '0 12px', borderRadius: 8,
            border: '1px solid #2a2d3e', fontSize: 13, color: '#ffffff',
            outline: 'none', background: '#1a1d2e',
          }}
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          style={{
            height: 36, padding: '0 10px', borderRadius: 8,
            border: '1px solid #2a2d3e', fontSize: 13, color: '#ffffff',
            background: '#1a1d2e', cursor: 'pointer', minWidth: 140,
          }}
        >
          {types.map((t) => (
            <option key={t} value={t}>{t === 'all' ? 'All types' : t}</option>
          ))}
        </select>

        <div style={{ display: 'flex', border: '1px solid #2a2d3e', borderRadius: 8, overflow: 'hidden', height: 36 }}>
          {[
            { key: 'study', label: 'By study' },
            { key: 'type',  label: 'By type'  },
            { key: 'flat',  label: 'Flat'      },
          ].map(({ key, label }, i, arr) => (
            <button
              key={key}
              onClick={() => setGroupMode(key)}
              style={{
                padding: '0 12px', border: 'none',
                borderRight: i < arr.length - 1 ? '1px solid #2a2d3e' : 'none',
                cursor: 'pointer', fontSize: 12,
                fontWeight: groupMode === key ? 600 : 400,
                background: groupMode === key ? '#2a2d3e' : '#1a1d2e',
                color: groupMode === key ? '#00e5a0' : '#6b7280',
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: '48px 0', color: '#6b7280', fontSize: 14 }}>
          Loading objects…
        </div>
      )}

      {!loading && allObjects.length === 0 && (
        <div style={{
          textAlign: 'center', padding: '48px 0', color: '#6b7280', fontSize: 14,
          background: '#1a1d2e', borderRadius: 12, border: '1px dashed #2a2d3e',
        }}>
          No objects match your search.
        </div>
      )}

      {!loading && groups.map((group) => (
        <GroupSection
          key={group.groupKey}
          group={group}
          onSelect={onSelect}
          groupMode={groupMode}
          page={getPage(group.groupKey)}
          onLoadMore={() => loadMoreGroup(group.groupKey)}
        />
      ))}

      {!loading && hasMore && (
        <button
          onClick={handleLoadMoreFromServer}
          disabled={loadingMore}
          onMouseEnter={(e) => { if (!loadingMore) { e.currentTarget.style.borderColor = '#00e5a0'; e.currentTarget.style.color = '#00e5a0'; }}}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#2a2d3e'; e.currentTarget.style.color = '#6b7280'; }}
          style={{
            marginTop: 16, padding: '11px 0', background: 'none',
            border: '1px dashed #2a2d3e', borderRadius: 8,
            fontSize: 13, color: '#6b7280', cursor: loadingMore ? 'default' : 'pointer',
            width: '100%', transition: 'border-color 0.15s, color 0.15s',
            opacity: loadingMore ? 0.6 : 1,
          }}
        >
          {loadingMore ? 'Loading…' : `Load next ${PAGE_SIZE} objects`}
          {!loadingMore && serverTotal !== null && (
            <span style={{ color: '#6b7280', marginLeft: 6, fontSize: 12 }}>
              ({serverTotal - allObjects.length} remaining on server)
            </span>
          )}
        </button>
      )}
    </div>
  );
}

// ── ObjectDetail ──────────────────────────────────────────────────────
const SKIPPED_META_KEYS = new Set([
  'log_tail', 'celery_id', 'citations', 'structured',
]);

function MetaTable({ metadata }) {
  if (!metadata || !Object.keys(metadata).length) return null;
  const entries = Object.entries(metadata).filter(([k]) => !SKIPPED_META_KEYS.has(k));
  if (!entries.length) return null;
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <tbody>
        {entries.map(([k, v]) => (
          <tr key={k} style={{ borderBottom: '1px solid #2a2d3e' }}>
            <td style={{
              padding: '6px 12px 6px 0', color: '#6b7280', fontWeight: 500,
              whiteSpace: 'nowrap', width: '30%', verticalAlign: 'top',
            }}>{k}</td>
            <td style={{
              padding: '6px 0', color: '#ffffff', wordBreak: 'break-word',
              fontFamily: typeof v === 'string' && v.length > 40 ? 'monospace' : 'inherit',
              fontSize: typeof v === 'string' && v.length > 40 ? 11 : 13,
            }}>
              {typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LogTail({ logs }) {
  const [expanded, setExpanded] = useState(false);
  if (!logs || !logs.length) return null;
  const visible = expanded ? logs : logs.slice(-8);
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{
        background: '#1e1e2e', borderRadius: 8, padding: '12px 14px',
        fontFamily: 'monospace', fontSize: 11, color: '#cdd6f4',
        maxHeight: expanded ? 400 : 180, overflowY: 'auto',
        lineHeight: 1.6,
      }}>
        {!expanded && logs.length > 8 && (
          <div style={{ color: '#6c7086', marginBottom: 6 }}>
            … {logs.length - 8} earlier lines hidden
          </div>
        )}
        {visible.map((line, i) => {
          const color = line.startsWith('[ERROR]') ? '#f38ba8'
            : line.startsWith('[WARN]') ? '#fab387'
            : line.startsWith('[OK]') || line.startsWith('[DONE]') ? '#a6e3a1'
            : line.startsWith('[INFO]') ? '#89dceb'
            : '#cdd6f4';
          return (
            <div key={i} style={{ color, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {line || ' '}
            </div>
          );
        })}
      </div>
      <button
        onClick={() => setExpanded((e) => !e)}
        style={{
          marginTop: 6, background: 'none', border: 'none',
          fontSize: 12, color: '#0094ff', cursor: 'pointer', padding: 0,
        }}
      >
        {expanded ? '▲ Show less' : '▼ Show full log'}
      </button>
    </div>
  );
}

function LineageRow({ obj, isCurrent, onSelect }) {
  const [hovered, setHovered] = useState(false);
  const status = obj.metadata?.status;
  return (
    <div
      onClick={() => !isCurrent && onSelect(obj)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 12px', borderRadius: 8,
        border: isCurrent ? '1px solid #0094ff' : hovered ? '1px solid #2a2d3e' : '1px solid transparent',
        background: isCurrent ? '#0d1e2e' : hovered ? '#1a1d2e' : 'transparent',
        cursor: isCurrent ? 'default' : 'pointer',
        transition: 'all 0.15s',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: isCurrent ? 600 : 400, color: '#ffffff' }}>
            {obj.name || obj.object_type}
          </span>
          <span style={typeBadge(obj.object_type)}>{obj.object_type}</span>
          {status && (
            <span style={{ fontSize: 11, color: STATUS_COLOR[status] || '#6b7280', fontWeight: 500 }}>
              ● {status}
            </span>
          )}
          {isCurrent && (
            <span style={{ fontSize: 11, color: '#00e5a0', fontWeight: 600 }}>← current</span>
          )}
        </div>
        <div style={{ fontSize: 10, color: '#6b7280', fontFamily: 'monospace', marginTop: 1 }}>
          {obj.object_id}
        </div>
      </div>
      {!isCurrent && (
        <span style={{ fontSize: 12, color: hovered ? '#00e5a0' : '#6b7280' }}>Open →</span>
      )}
    </div>
  );
}

function ObjectDetail({ obj, objectId, onBack, onLaunch }) {
  const [relatives, setRelatives] = useState([]);
  const [loadingRel, setLoadingRel] = useState(true);

  const meta = obj.metadata || {};
  const hasLogs = Array.isArray(meta.log_tail) && meta.log_tail.length > 0;
  const progress = meta.progress;

  useEffect(() => {
    if (USE_MOCK) { setLoadingRel(false); return; }

    const fetches = [];

    fetches.push(
      fetch(`${BASE_URL}/api/dev/objects/?parent_id=${objectId}&page_size=50`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      })
        .then((r) => r.json())
        .then((d) => (Array.isArray(d.objects) ? d.objects : []))
        .catch(() => [])
    );

    if (obj.parent_id) {
      fetches.push(
        fetch(`${BASE_URL}/api/dev/objects/?parent_id=${obj.parent_id}&page_size=50`, {
          headers: { Authorization: `Bearer ${TOKEN}` },
        })
          .then((r) => r.json())
          .then((d) => (Array.isArray(d.objects) ? d.objects : []))
          .catch(() => [])
      );

      fetches.push(
        fetch(`${BASE_URL}/api/dev/objects/${obj.parent_id}/`, {
          headers: { Authorization: `Bearer ${TOKEN}` },
        })
          .then((r) => r.json())
          .catch(() => null)
      );
    }

    Promise.all(fetches).then(([children, siblings, parent]) => {
      const seen = new Set([objectId]);
      const list = [];

      if (parent) { seen.add(parent.object_id); list.push({ ...parent, _rel: 'parent' }); }

      (siblings || []).forEach((s) => {
        if (!seen.has(s.object_id)) { seen.add(s.object_id); list.push({ ...s, _rel: 'sibling' }); }
      });

      (children || []).forEach((c) => {
        if (!seen.has(c.object_id)) { seen.add(c.object_id); list.push({ ...c, _rel: 'child' }); }
      });

      setRelatives(list);
      setLoadingRel(false);
    });
  }, [objectId, obj.parent_id]);

  const section = (title, children) => (
    <div style={{ marginBottom: 24 }}>
      <div style={{
        fontSize: 11, fontWeight: 600, color: '#6b7280', letterSpacing: '0.8px',
        textTransform: 'uppercase', marginBottom: 10,
      }}>{title}</div>
      {children}
    </div>
  );

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '0 16px 80px' }}>
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '20px 0', borderBottom: '1px solid #2a2d3e', marginBottom: 24,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={onBack}
            style={{
              background: 'none', border: '1px solid #2a2d3e', borderRadius: 6,
              padding: '4px 10px', fontSize: 12, color: '#6b7280', cursor: 'pointer',
            }}
          >
            ← Back
          </button>
          <span style={{ fontWeight: 700, fontSize: 18, color: '#00e5a0' }}>OmniBioAI</span>
        </div>
        <span style={typeBadge(obj.object_type)}>{obj.object_type}</span>
      </header>

      <div style={{ marginBottom: 24 }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#ffffff' }}>
          {obj.name || obj.object_type}
        </h2>
        <div style={{ fontSize: 12, color: '#6b7280', fontFamily: 'monospace', marginTop: 4 }}>
          {objectId}
        </div>
        {obj.created_by && (
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
            Created by <strong style={{ color: '#ffffff' }}>{obj.created_by}</strong>
          </div>
        )}

        {progress !== undefined && (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
              <span>Progress</span><span>{progress}%</span>
            </div>
            <div style={{ height: 6, background: '#2a2d3e', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 3,
                width: `${progress}%`,
                background: progress === 100 ? '#00e5a0' : '#0094ff',
                transition: 'width 0.3s',
              }} />
            </div>
          </div>
        )}
      </div>

      {section('Metadata', <MetaTable metadata={meta} />)}

      {obj.inputs && obj.inputs.length > 0 && section('Inputs',
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {obj.inputs.map((inp) => (
            <div key={inp} style={{
              fontSize: 12, fontFamily: 'monospace', color: '#0094ff',
              padding: '4px 8px', background: '#0d1e2e', borderRadius: 4,
              cursor: 'pointer',
            }}
              onClick={() => onLaunch(inp)}
            >
              {inp}
            </div>
          ))}
        </div>
      )}

      {hasLogs && section('Job Log', <LogTail logs={meta.log_tail} />)}

      {section('Lineage',
        loadingRel
          ? <div style={{ fontSize: 13, color: '#6b7280' }}>Loading related objects…</div>
          : relatives.length === 0
            ? <div style={{ fontSize: 13, color: '#6b7280' }}>No related objects found.</div>
            : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <LineageRow obj={{ ...obj, object_id: objectId }} isCurrent onSelect={() => {}} />
                {['parent', 'sibling', 'child'].map((rel) => {
                  const items = relatives.filter((r) => r._rel === rel);
                  if (!items.length) return null;
                  return (
                    <div key={rel}>
                      <div style={{
                        fontSize: 10, color: '#6b7280', textTransform: 'uppercase',
                        letterSpacing: '0.6px', padding: '8px 12px 4px',
                      }}>
                        {rel === 'parent' ? '↑ Parent' : rel === 'child' ? '↓ Children' : '↔ Siblings'}
                      </div>
                      {items.map((r) => (
                        <LineageRow
                          key={r.object_id}
                          obj={r}
                          isCurrent={false}
                          onSelect={(o) => onLaunch(o.object_id)}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            )
      )}

      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        background: 'rgba(15,17,23,0.95)', backdropFilter: 'blur(8px)',
        borderTop: '1px solid #2a2d3e', padding: '12px 24px',
        display: 'flex', justifyContent: 'center',
      }}>
        <button
          onClick={() => onLaunch(objectId)}
          style={{
            background: '#00e5a0', color: '#0f1117', border: 'none',
            borderRadius: 8, padding: '10px 48px', fontSize: 14,
            fontWeight: 600, cursor: 'pointer', maxWidth: 400, width: '100%',
            transition: 'background 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = '#00c98a'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = '#00e5a0'; }}
        >
          Open in Environment →
        </button>
      </div>
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────
function App() {
  const params = new URLSearchParams(window.location.search);
  const urlObjectId = params.get('object_id');

  const [view, setView]                     = useState(urlObjectId ? 'launcher' : 'list');
  const [selectedObject, setSelectedObject] = useState(null);
  const [obj, setObj]                       = useState(null);
  const [loading, setLoading]               = useState(false);
  const [fetchError, setFetchError]         = useState(null);
  const [selected, setSelected]             = useState('notebook');
  const [toast, setToast]                   = useState(null);
  const [modal, setModal]                   = useState(null);

  const objectId = urlObjectId || selectedObject?.object_id || null;

  useEffect(() => {
    if (!objectId) return;
    if (selectedObject?.object_id === objectId) { setObj(selectedObject); return; }
    if (shouldUseMock(objectId)) { setObj(MOCK_OBJECT); return; }

    setLoading(true);
    setFetchError(null);
    fetch(`${BASE_URL}/api/dev/objects/${objectId}/`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data) => {
        const empty = !data || data.count === 0 || (Array.isArray(data) && !data.length);
        setObj(empty ? MOCK_OBJECT : data);
        setLoading(false);
      })
      .catch((err) => { setFetchError(err.message); setLoading(false); });
  }, [objectId, selectedObject]);

  const showToast = (msg) => { setToast(null); setTimeout(() => setToast(msg), 10); };

  const openObject = useCallback((id) => {
    setLoading(true);
    fetch(`${BASE_URL}/api/dev/objects/${id}/`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    })
      .then((r) => r.json())
      .then((data) => {
        setSelectedObject(data);
        setObj(data);
        setLoading(false);
        setView('detail');
      })
      .catch(() => setLoading(false));
  }, []);

  const notebookUrl = `${JUPYTER_BASE}/lab?token=${JUPYTER_TOKEN}&omnibioai_object_id=${objectId}`;

  const envVarSnippet =
    `export OMNIBIOAI_OBJECT_ID="${objectId}"\n` +
    `export OMNIBIOAI_BASE_URL="${BASE_URL}"\n` +
    `export OMNIBIOAI_TOKEN="${TOKEN}"\n\n` +
    `# Paste in terminal, then:\n` +
    `from omnibioai_sdk import OmniClient\nimport os\n` +
    `c = OmniClient()\n` +
    `obj = c.object_get(os.environ["OMNIBIOAI_OBJECT_ID"])\n` +
    `print(obj["object_type"], obj["metadata"])`;

  const buildRScript = () => {
    const name = obj?.name || obj?.object_type || 'Unknown';
    const objectType = obj?.object_type || 'Unknown';
    return (
      `# OmniBioAI — auto-generated starter script\n# Object: ${name}\n# Type:   ${objectType}\n# ID:     ${objectId}\n\n` +
      `Sys.setenv(\n  OMNIBIOAI_OBJECT_ID = "${objectId}",\n  OMNIBIOAI_BASE_URL  = "${BASE_URL}",\n  OMNIBIOAI_TOKEN     = "${TOKEN}"\n)\n\n` +
      `library(httr2)\n\nobj <- request(Sys.getenv("OMNIBIOAI_BASE_URL")) |>\n` +
      `  req_url_path(paste0("/api/dev/objects/", Sys.getenv("OMNIBIOAI_OBJECT_ID"), "/")) |>\n` +
      `  req_headers(Authorization = paste("Bearer", Sys.getenv("OMNIBIOAI_TOKEN"))) |>\n` +
      `  req_perform() |>\n  resp_body_json()\n\ncat("Loaded:", obj$object_type, "\\n")\nprint(obj$metadata)\n`
    );
  };

  const downloadRScript = () => {
    const blob = new Blob([buildRScript()], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), {
      href: url, download: `omnibioai_${(objectId || '').slice(0, 8)}.R`,
    });
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  const handleAction = (type) => {
    if (type === 'notebook') {
      window.open(notebookUrl, '_blank');
    } else if (type === 'vscode') {
      navigator.clipboard.writeText(envVarSnippet)
        .then(() => showToast('Env vars copied — paste in your VS Code terminal'))
        .catch(() => showToast('Copy failed — check browser clipboard permissions'));
    } else if (type === 'r') {
      downloadRScript();
      fetch(`${BASE_URL}/api/dev/launch/rstudio/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ object_id: objectId }),
      })
        .then((r) => r.json())
        .then((data) => {
          showToast(data.ok ? 'RStudio launched with R script' : 'R script downloaded — open manually in RStudio');
        })
        .catch(() => showToast('R script downloaded — open manually in RStudio'));
    }
  };

  const handleCardClick = (type) => { setSelected(type); handleAction(type); };

  // ── List view ──────────────────────────────────────────────────────
  if (view === 'list') {
    return (
      <div className="app">
        <ObjectSelector onSelect={(o) => {
          setSelectedObject(o);
          setObj(o);
          setView('detail');
        }} />
        {toast && <Toast key={toast + Date.now()} message={toast} />}
      </div>
    );
  }

  // ── Detail view ────────────────────────────────────────────────────
  if (view === 'detail' && obj) {
    return (
      <div className="app">
        <ObjectDetail
          obj={obj}
          objectId={objectId}
          onBack={() => { if (!urlObjectId) setView('list'); }}
          onLaunch={(id) => {
            if (id === objectId) { setView('launcher'); }
            else { openObject(id); }
          }}
        />
        {toast && <Toast key={toast + Date.now()} message={toast} />}
      </div>
    );
  }

  // ── Launcher view ──────────────────────────────────────────────────
  return (
    <div className="app">
      <header className="header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {!urlObjectId && (
            <button
              onClick={() => setView('detail')}
              style={{
                background: 'none', border: '1px solid #2a2d3e', borderRadius: 6,
                padding: '4px 10px', fontSize: 12, color: '#6b7280', cursor: 'pointer',
              }}
            >
              ← Back
            </button>
          )}
          <span className="logo">OmniBioAI</span>
        </div>
        {obj && <span className="type-badge">{obj.object_type}</span>}
      </header>

      {loading && <div className="spinner-wrap"><div className="spinner" /></div>}
      {fetchError && <div className="error-card">Error loading object: {fetchError}</div>}

      {obj && (
        <>
          <ObjectCard obj={obj} objectId={objectId} />
          <div className="section-label">Open in environment</div>
          <div className="env-grid">
            <EnvCard type="notebook" title="Notebook"
              description="JupyterLab with object context preloaded"
              selected={selected === 'notebook'} onClick={() => handleCardClick('notebook')} />
            <EnvCard type="vscode" title="VS Code"
              description="Copy env vars — paste in VS Code terminal"
              selected={selected === 'vscode'} onClick={() => handleCardClick('vscode')} />
            <EnvCard type="r" title="R / RStudio"
              description="Download R script + launch RStudio"
              selected={selected === 'r'} onClick={() => handleCardClick('r')} />
          </div>
          <button className="launch-btn" onClick={() => handleAction(selected)}>
            {LAUNCH_LABELS[selected]}
          </button>
        </>
      )}

      {toast && <Toast key={toast + Date.now()} message={toast} />}
      {modal && <InstallModal type={modal} onDismiss={() => setModal(null)} />}
    </div>
  );
}

export default App;

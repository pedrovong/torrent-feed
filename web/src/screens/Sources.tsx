import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type Category, type Source, type Status, type TestResult } from '../api';
import { Section, Switch, PageHeader } from '../components/ui';
import { useToast } from '../components/Toast';
import { formatIn, formatRelative } from '../lib';

const PRUNE_CHOICES = [7, 14, 30, 60, 90];

function statusLine(s: Source): { text: string; bad: boolean } {
  if (!s.enabled) return { text: 'Paused', bad: false };
  if (s.last_status === 'error') return { text: `Error · ${s.last_error ?? 'failed'}`, bad: true };
  if (!s.last_fetched_at) return { text: 'Not fetched yet', bad: false };
  return { text: `Updated ${formatRelative(s.last_fetched_at)} · ${s.item_count} items`, bad: false };
}

export function Sources() {
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<Source | 'new' | null>(null);

  const sources = useQuery({ queryKey: ['sources'], queryFn: () => api<Source[]>('/sources'), refetchInterval: 15_000 });
  const status = useQuery({ queryKey: ['status', 'sources'], queryFn: () => api<Status>('/status'), refetchInterval: 15_000 });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<{ prune_days: number }>('/settings') });

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ['sources'] });
    qc.invalidateQueries({ queryKey: ['status'] });
    qc.invalidateQueries({ queryKey: ['items'] });
  };

  const toggle = useMutation({
    mutationFn: (s: Source) => api(`/sources/${s.id}`, { method: 'PATCH', body: { enabled: !s.enabled } }),
    onSuccess: refreshAll,
    onError: (e) => toast.show((e as Error).message),
  });
  const poll = useMutation({
    mutationFn: () => api<{ ok: boolean; added: number; results: Array<{ error?: string }> }>('/ingest/poll', { method: 'POST' }),
    onSuccess: (r) => {
      toast.show(r.ok ? `Polled · ${r.added} new` : `Poll finished with errors: ${r.results.find((x) => x.error)?.error ?? ''}`);
      refreshAll();
    },
    onError: (e) => toast.show((e as Error).message),
  });
  const prune = useMutation({
    mutationFn: (days: number) => api<{ deleted: number }>('/maintenance/prune', { method: 'POST', body: { older_than_days: days } }),
    onSuccess: (r) => {
      toast.show(`Pruned ${r.deleted} items`);
      refreshAll();
    },
    onError: (e) => toast.show((e as Error).message),
  });

  if (editing) {
    return (
      <SourceEditor
        source={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          refreshAll();
        }}
      />
    );
  }

  const st = status.data;
  const pruneDays = settings.data?.prune_days ?? 30;

  return (
    <div className="screen">
      <PageHeader
        title="Sources"
        action={
          <button className="link-action" onClick={() => setEditing('new')}>
            Add
          </button>
        }
      />
      <div className="pad">
        <div className="group">
          <div className="list-row">
            <div>
              <div className="primary">Backend ingest</div>
              <div className="secondary">
                {st?.poll_interval_min ? `Polling every ${st.poll_interval_min} min · next in ${formatIn(st.next_poll_at)}` : 'No enabled feeds'}
              </div>
            </div>
            <button className="pill-btn" disabled={poll.isPending} onClick={() => poll.mutate()}>
              {poll.isPending ? 'Polling…' : 'Poll now'}
            </button>
          </div>
        </div>

        <Section label="Feeds">
          {sources.isError && <div className="empty">{(sources.error as Error).message}</div>}
          {sources.data?.length === 0 && <div className="empty">No feeds yet. Tap Add to create one.</div>}
          {!!sources.data?.length && (
            <div className="group">
              {sources.data.map((s) => {
                const line = statusLine(s);
                return (
                  <div className="list-row" key={s.id}>
                    <button style={{ flex: 1, minWidth: 0, textAlign: 'left' }} onClick={() => setEditing(s)}>
                      <div className="primary">{s.name}</div>
                      <div className="secondary" style={line.bad ? { color: 'var(--error)' } : undefined}>
                        {line.text}
                      </div>
                    </button>
                    <Switch on={s.enabled} label={`Enable ${s.name}`} onChange={() => toggle.mutate(s)} />
                  </div>
                );
              })}
            </div>
          )}
        </Section>

        <Section label="Database">
          <div className="group">
            <div className="list-row">
              <span className="primary">Torrents indexed</span>
              <span className="value">{st?.items_total.toLocaleString() ?? '—'}</span>
            </div>
            <div className="list-row">
              <span className="primary">Prune items older than</span>
              <select
                className="field-input"
                style={{ flex: 'none' }}
                value={PRUNE_CHOICES.includes(pruneDays) ? pruneDays : 30}
                onChange={(e) => {
                  const days = Number(e.target.value);
                  if (window.confirm(`Delete all items older than ${days} days (except ones you sent)?`)) prune.mutate(days);
                }}
              >
                {PRUNE_CHOICES.map((d) => (
                  <option key={d} value={d}>
                    {d} days
                  </option>
                ))}
              </select>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}

// ---- feed editor ------------------------------------------------------------

const CATEGORIES: Array<Category | ''> = ['', 'TV', 'Movies', 'Music', 'Linux', 'Other'];

function SourceEditor({ source, onClose, onSaved }: { source: Source | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    name: source?.name ?? '',
    url: source?.url ?? '',
    type: (source?.type ?? 'auto') as 'auto' | 'rss' | 'knaben',
    category_default: (source?.category_default ?? '') as Category | '',
    interval_min: String(source?.interval_min ?? 15),
    headers_json: source?.headers_json ?? '',
    detail_headers_json: source?.detail_headers_json ?? '',
    include_regex: source?.include_regex ?? '',
    exclude_regex: source?.exclude_regex ?? '',
  });
  const [test, setTest] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  const body = () => ({
    name: f.name.trim(),
    url: f.url.trim(),
    ...(f.type !== 'auto' ? { type: f.type } : {}),
    category_default: f.category_default || null,
    interval_min: Number(f.interval_min) || 15,
    headers_json: f.headers_json.trim() || null,
    detail_headers_json: f.detail_headers_json.trim() || null,
    include_regex: f.include_regex.trim() || null,
    exclude_regex: f.exclude_regex.trim() || null,
  });

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      const b = body();
      setTest(await api<TestResult>('/sources/test', { method: 'POST', body: { url: b.url, type: b.type, headers_json: b.headers_json, category_default: b.category_default } }));
    } catch (e) {
      setTest({ ok: false, error: (e as Error).message });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      if (source) await api(`/sources/${source.id}`, { method: 'PATCH', body: body() });
      else await api('/sources', { method: 'POST', body: body() });
      onSaved();
    } catch (e) {
      toast.show((e as Error).message);
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!source || !window.confirm(`Delete "${source.name}" and all items it ingested?`)) return;
    try {
      await api(`/sources/${source.id}`, { method: 'DELETE' });
      onSaved();
    } catch (e) {
      toast.show((e as Error).message);
    }
  };

  const valid = f.name.trim() && /^https?:\/\//.test(f.url.trim());

  return (
    <div className="screen">
      <button className="back" onClick={onClose}>
        ‹ Sources
      </button>
      <div className="head" style={{ paddingTop: 0 }}>
        <h1 className="title page">{source ? 'Edit feed' : 'New feed'}</h1>
        <button className="link-action" disabled={!valid || saving} onClick={save} style={!valid ? { opacity: 0.4 } : undefined}>
          Save
        </button>
      </div>
      <div className="pad">
        <div className="group">
          <label className="list-row">
            <span className="primary">Name</span>
            <input className="field-input" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="My feed" />
          </label>
          <label className="list-row">
            <span className="primary">URL</span>
            <input className="field-input" value={f.url} onChange={(e) => set('url', e.target.value)} placeholder="https://…" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
          </label>
          <label className="list-row">
            <span className="primary">Format</span>
            <select className="field-input" style={{ flex: 'none' }} value={f.type} onChange={(e) => set('type', e.target.value as typeof f.type)}>
              <option value="auto">Auto-detect</option>
              <option value="knaben">Knaben JSON</option>
              <option value="rss">RSS / Atom / Torznab</option>
            </select>
          </label>
          <label className="list-row">
            <span className="primary">Default category</span>
            <select className="field-input" style={{ flex: 'none' }} value={f.category_default} onChange={(e) => set('category_default', e.target.value as Category | '')}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c || 'Auto'}
                </option>
              ))}
            </select>
          </label>
          <label className="list-row">
            <span className="primary">Poll every (min)</span>
            <input className="field-input" value={f.interval_min} onChange={(e) => set('interval_min', e.target.value.replace(/\D/g, ''))} inputMode="numeric" />
          </label>
        </div>

        <Section label="Filters (regex, case-insensitive)">
          <div className="group">
            <label className="list-row">
              <span className="primary">Include</span>
              <input className="field-input" value={f.include_regex} onChange={(e) => set('include_regex', e.target.value)} placeholder="1080p|2160p" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
            </label>
            <label className="list-row">
              <span className="primary">Exclude</span>
              <input className="field-input" value={f.exclude_regex} onChange={(e) => set('exclude_regex', e.target.value)} placeholder="CAM|HDTS" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
            </label>
          </div>
        </Section>

        <Section label="Feed request headers / cookies (JSON)">
          <div className="group">
            <div className="list-row">
              <textarea className="field-area" value={f.headers_json} onChange={(e) => set('headers_json', e.target.value)} placeholder='{"Cookie": "uid=…; pass=…"}' spellCheck={false} />
            </div>
          </div>
        </Section>

        <Section label="Detail page headers / cookies (JSON)">
          <div className="group">
            <div className="list-row">
              <textarea className="field-area" value={f.detail_headers_json} onChange={(e) => set('detail_headers_json', e.target.value)} placeholder='{"Cookie": "cf_clearance=…", "User-Agent": "…"}' spellCheck={false} />
            </div>
          </div>
          <div className="hint" style={{ margin: '6px 4px 0' }}>
            Sent when the server fetches an item's description page. Needed if the site sits behind bot protection.
          </div>
        </Section>

        <div style={{ marginTop: 20 }} className="stack-gap">
          <button className="btn-card" disabled={testing || !valid} onClick={runTest}>
            {testing ? 'Fetching…' : 'Test fetch'}
          </button>
          {test && (
            <div className="group">
              <div className="test-result">
                {test.ok ? (
                  <>
                    <div className="ok">
                      ✓ {test.count} items ({test.type})
                    </div>
                    {test.sample?.map((t, i) => (
                      <div key={i}>{t}</div>
                    ))}
                  </>
                ) : (
                  <div className="bad">✕ {test.error}</div>
                )}
              </div>
            </div>
          )}
          {source && (
            <button className="btn-card danger" onClick={remove}>
              Delete feed
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

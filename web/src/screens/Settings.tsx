import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, type ServerSettings, type Status } from '../api';
import { PageHeader, Section, Switch } from '../components/ui';
import { updateConfig, useConfig, type ThemePref } from '../store';

const THEMES: Array<[ThemePref, string]> = [
  ['system', 'Match system'],
  ['light', 'Light'],
  ['dark', 'Dark'],
];

/** Text field that commits on blur, so we don't PUT on every keystroke. */
function Field({ label, value, onCommit, type = 'text', placeholder }: { label: string; value: string; onCommit: (v: string) => void; type?: string; placeholder?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <label className="list-row">
      <span className="primary">{label}</span>
      <input
        className="field-input"
        type={type}
        value={v}
        placeholder={placeholder}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => v !== value && onCommit(v)}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        autoComplete="off"
      />
    </label>
  );
}

export function Settings() {
  const cfg = useConfig();
  const qc = useQueryClient();
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const status = useQuery({ queryKey: ['status', 'settings', cfg.serverUrl, cfg.token], queryFn: () => api<Status>('/status'), retry: false, refetchInterval: 20_000 });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<ServerSettings>('/settings'), enabled: status.isSuccess });

  const save = useMutation({
    mutationFn: (patch: Record<string, unknown>) => api<ServerSettings>('/settings', { method: 'PUT', body: patch }),
    onSuccess: (data) => {
      setSaveErr(null);
      qc.setQueryData(['settings'], data);
    },
    onError: (e) => setSaveErr((e as Error).message),
  });

  const testAll = useMutation({
    mutationFn: async () => {
      const s = await api<Status>('/status');
      const c = await api<{ ok: boolean; version?: string; error?: string }>('/settings/test-client', { method: 'POST' });
      return { s, c };
    },
    onSuccess: ({ s, c }) =>
      setTestMsg(
        c.ok
          ? { ok: true, text: `Server v${s.version} · Transmission ${c.version}` }
          : { ok: false, text: `Server v${s.version} OK, but Transmission failed: ${c.error}` },
      ),
    onError: (e) => setTestMsg({ ok: false, text: `Server: ${(e as Error).message}` }),
  });

  const s = settings.data;
  const connected = status.isSuccess;

  return (
    <div className="screen">
      <PageHeader title="Settings" />
      <div className="pad">
        <Section label="Feed server">
          <div className="group">
            <Field
              label="Address"
              value={cfg.serverUrl}
              placeholder={window.location.origin}
              onCommit={(v) => {
                updateConfig({ serverUrl: v.trim() });
                qc.invalidateQueries();
              }}
            />
            <Field
              label="API token"
              type="password"
              value={cfg.token}
              placeholder="Required"
              onCommit={(v) => {
                updateConfig({ token: v.trim() });
                qc.invalidateQueries();
              }}
            />
            <div className="list-row">
              <span className="primary">Status</span>
              <span className={`value ${connected ? 'ok' : 'bad'}`}>
                {status.isPending ? '…' : connected ? `● Connected · v${status.data.version}` : `● ${(status.error as Error).message}`}
              </span>
            </div>
          </div>
        </Section>

        <Section label="Torrent client">
          <div className="group">
            <div className="list-row">
              <span className="primary">Type</span>
              <span className="value">Transmission</span>
            </div>
            {s && (
              <>
                <Field label="RPC URL" value={s.transmission_url} placeholder="http://truenas:9091" onCommit={(v) => save.mutate({ transmission_url: v.trim() })} />
                <Field label="Username" value={s.transmission_user} placeholder="Optional" onCommit={(v) => save.mutate({ transmission_user: v })} />
                <Field label="Password" type="password" value="" placeholder={s.transmission_password_set ? '••••••••' : 'Optional'} onCommit={(v) => save.mutate({ transmission_password: v })} />
                <Field label="Default folder" value={s.download_dir} placeholder="Transmission default" onCommit={(v) => save.mutate({ download_dir: v.trim() })} />
                <div className="list-row">
                  <span className="primary">Start paused</span>
                  <Switch on={s.start_paused} label="Start paused" onChange={(v) => save.mutate({ start_paused: v })} />
                </div>
                <div className="list-row">
                  <div>
                    <div className="primary">Prefetch descriptions</div>
                    <div className="secondary">Fetch detail pages for new items in the background</div>
                  </div>
                  <Switch on={s.prefetch_details} label="Prefetch descriptions" onChange={(v) => save.mutate({ prefetch_details: v })} />
                </div>
              </>
            )}
            {!s && <div className="list-row"><span className="hint">Connect to the server to configure the client.</span></div>}
          </div>
          {saveErr && <div className="hint" style={{ color: 'var(--error)', margin: '6px 4px 0' }}>{saveErr}</div>}
        </Section>

        <div style={{ marginTop: 20 }} className="stack-gap">
          <button className="btn-card" disabled={testAll.isPending} onClick={() => testAll.mutate()}>
            {testAll.isPending ? 'Testing…' : 'Test connections'}
          </button>
          {testMsg && (
            <div className="group">
              <div className="test-result">
                <span className={testMsg.ok ? 'ok' : 'bad'}>{testMsg.ok ? '✓ ' : '✕ '}</span>
                {testMsg.text}
              </div>
            </div>
          )}
        </div>

        <Section label="Appearance">
          <div className="group">
            <div className="list-row">
              <span className="primary">Theme</span>
              <div className="seg" role="radiogroup" aria-label="Theme">
                {THEMES.map(([k, label]) => (
                  <button key={k} role="radio" aria-checked={cfg.theme === k} className={cfg.theme === k ? 'on' : ''} onClick={() => updateConfig({ theme: k })}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}

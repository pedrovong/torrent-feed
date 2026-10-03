import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { api, type ItemDetail, type ServerSettings } from '../api';
import { useItemActions } from '../actions';
import { useToast } from '../components/Toast';
import { ImageBlock, Section } from '../components/ui';
import { catColor, formatAge, formatSize, haptic } from '../lib';
import { closeItem, type Screen } from '../nav';
import { rememberFolder, useConfig } from '../store';

const DISMISS_THRESHOLD = 80;

export function Detail({ id, screen }: { id: number; screen: Screen }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { send, hide } = useItemActions();
  const { recentFolders } = useConfig();

  const { data: item, error } = useQuery({
    queryKey: ['item', id],
    queryFn: () => api<ItemDetail>(`/items/${id}`),
    refetchInterval: (q) => (q.state.data?.details_status === 'pending' ? 2000 : false),
  });
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: () => api<ServerSettings>('/settings'), staleTime: 60_000 });

  const [folder, setFolder] = useState<string | null>(null);
  const downloadDir = folder ?? recentFolders[0] ?? settings?.download_dir ?? '';

  // Slide-out animation state
  const [dx, setDx] = useState(0);
  const [settle, setSettle] = useState(false);
  const dxRef = useRef(0);
  const g = useRef<{ x: number; y: number; dragging: boolean; crossed: boolean } | null>(null);

  const close = (direction: 'left' | 'right') => {
    setSettle(true);
    dxRef.current = direction === 'left' ? -window.innerWidth : window.innerWidth;
    setDx(dxRef.current);
    window.setTimeout(() => closeItem(screen), 200);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close('right');
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Swipe left to dismiss; detail follows the finger only for leftward movement.
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('input,textarea,button,a')) return;
    g.current = { x: e.clientX, y: e.clientY, dragging: false, crossed: false };
    setSettle(false);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const s = g.current;
    if (!s) return;
    const ddx = e.clientX - s.x;
    const ddy = e.clientY - s.y;
    if (!s.dragging) {
      if (Math.abs(ddy) > 8 && Math.abs(ddy) > Math.abs(ddx)) return void (g.current = null);
      if (ddx > -8) return;
      s.dragging = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    dxRef.current = Math.min(0, ddx);
    setDx(dxRef.current);
    const past = dxRef.current < -DISMISS_THRESHOLD;
    if (past && !s.crossed) haptic();
    s.crossed = past;
  };
  const onUp = (e: PointerEvent<HTMLDivElement>, cancelled = false) => {
    const s = g.current;
    g.current = null;
    if (!s?.dragging) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!cancelled && dxRef.current < -DISMISS_THRESHOLD) return close('left');
    setSettle(true);
    dxRef.current = 0;
    setDx(0);
  };

  const download = async () => {
    if (!item || item.state === 'sent') return;
    const ok = await send(item, { download_dir: downloadDir || undefined });
    if (ok) rememberFolder(downloadDir);
  };

  const dismiss = async () => {
    if (!item) return;
    close('right');
    await hide(item);
  };

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.show(`${what} copied`);
    } catch {
      toast.show("Couldn't copy");
    }
  };

  const retry = async () => {
    await api(`/items/${id}/refresh-details`, { method: 'POST' });
    qc.invalidateQueries({ queryKey: ['item', id] });
  };

  const pendingImages = item?.images.some((i) => i.status === 'pending') || item?.details_status === 'pending';
  const failedImages = item?.images.filter((i) => i.status === 'failed').length ?? 0;
  const sent = item?.state === 'sent';

  return (
    <div
      className={`detail${settle ? ' settle' : ''}`}
      style={{ transform: dx ? `translateX(${dx}px)` : undefined }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={(e) => onUp(e)}
      onPointerCancel={(e) => onUp(e, true)}
      onTransitionEnd={() => setSettle(false)}
    >
      <div className="detail-top">
        <button className="back" onClick={() => close('right')}>
          ‹ Today
        </button>
      </div>

      <div className="detail-scroll">
        {error && !item && <div className="empty">{(error as Error).message}</div>}
        {!item && !error && <div className="empty skeleton">Loading…</div>}
        {item && (
          <>
            <div className="detail-meta" style={{ color: catColor(item.category) }}>
              {item.category} · {item.origin ?? item.source_name} · {formatAge(item.published_at)} ago
            </div>
            <h1 className="detail-title">{item.title}</h1>
            {item.tags.length > 0 && (
              <div className="tags">
                {item.tags.map((t) => (
                  <span className="tag" key={t}>
                    {t}
                  </span>
                ))}
              </div>
            )}

            <div className="stats">
              <div className="stat">
                <div className="l">Size</div>
                <div className="v">{formatSize(item.size_bytes)}</div>
              </div>
              <div className="stat">
                <div className="l">Seeders</div>
                <div className="v" style={{ color: 'var(--accent)' }}>
                  {item.seeders}
                </div>
              </div>
              <div className="stat">
                <div className="l">Leechers</div>
                <div className="v">{item.leechers}</div>
              </div>
            </div>

            <Section label="Download to">
              <input
                className="input"
                list="recent-folders"
                value={downloadDir}
                placeholder="Transmission default"
                onChange={(e) => setFolder(e.target.value)}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
              <datalist id="recent-folders">
                {[...new Set([...recentFolders, settings?.download_dir ?? ''])].filter(Boolean).map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
            </Section>

            {item.info_hash && (
              <Section label="Info hash">
                <div className="card-pad">
                  <button className="mono" style={{ textAlign: 'left' }} onClick={() => copy(item.info_hash!, 'Hash')}>
                    {item.info_hash}
                  </button>
                  {item.magnet && (
                    <div style={{ marginTop: 10 }}>
                      <button className="pill-btn" onClick={() => copy(item.magnet!, 'Magnet link')}>
                        Copy magnet
                      </button>
                    </div>
                  )}
                </div>
              </Section>
            )}

            {item.files.length > 0 && (
              <Section label={`Files (${item.files.length})`}>
                <div className="group">
                  {item.files.slice(0, 100).map((f, i) => (
                    <div className="file-row" key={i}>
                      <span>{f.path}</span>
                      <span>{formatSize(f.size_bytes)}</span>
                    </div>
                  ))}
                  {item.files.length > 100 && <div className="file-row"><span>… and {item.files.length - 100} more</span></div>}
                </div>
              </Section>
            )}

            <Section label="Description">
              <div className="card-pad">
                {item.details_status === 'pending' && <p className="hint skeleton">Fetching details…</p>}
                {item.details_status === 'failed' && (
                  <>
                    <p style={{ color: 'var(--error)', fontSize: 13 }}>{item.details_error ?? 'Could not fetch details.'}</p>
                    <button className="pill-btn" onClick={retry}>
                      Retry
                    </button>
                  </>
                )}
                {item.details_status === 'ok' && item.description.length === 0 && <p className="hint">No description available.</p>}
                {item.description.map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
                {item.details_url && (
                  <p style={{ marginTop: 10 }}>
                    <a href={item.details_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13 }}>
                      Open source page ↗
                    </a>
                  </p>
                )}
              </div>
            </Section>

            <Section
              label={`Images (${item.images.length})`}
              right={
                item.images.length > 0 ? (
                  <span style={{ color: pendingImages ? 'var(--sub)' : 'var(--accent)', fontWeight: 600 }}>
                    {pendingImages ? 'Prefetching…' : failedImages ? `${failedImages} failed` : '✓ Prefetched'}
                  </span>
                ) : undefined
              }
            >
              {item.images.filter((i) => i.status !== 'failed').map((im) => <ImageBlock key={im.id} image={im} />)}
              {item.images.length === 0 && item.details_status === 'ok' && <p className="hint" style={{ margin: '0 4px' }}>No images linked in this description.</p>}
              {item.images.length > 0 && (
                <div className="stack-gap">
                  {item.images.map((im) => (
                    <div className="mono green" key={im.id}>
                      {im.source_url}
                    </div>
                  ))}
                </div>
              )}
            </Section>
          </>
        )}
      </div>

      <div className="detail-bar">
        <button className={`btn-main${sent ? ' sent' : ''}`} disabled={!item || sent} onClick={download}>
          {sent ? 'Sent to Transmission ✓' : 'Download'}
        </button>
        <button className="btn-sec" disabled={!item} onClick={dismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

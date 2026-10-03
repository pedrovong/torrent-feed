import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { fetchImageBlobUrl, type ItemImage } from '../api';
import { navigate } from '../nav';

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button role="switch" aria-checked={on} aria-label={label} className={`switch${on ? ' on' : ''}`} onClick={() => onChange(!on)} />;
}

export function Chips<T extends string>({ options, value, onChange }: { options: readonly T[]; value: T | T[]; onChange: (v: T) => void }) {
  const sel = Array.isArray(value) ? value : [value];
  return (
    <div className="chips">
      {options.map((o) => (
        <button key={o} className={`chip${sel.includes(o) ? ' on' : ''}`} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}

export function BackBar() {
  return (
    <button className="back" onClick={() => navigate('feed')}>
      ‹ Today
    </button>
  );
}

export function PageHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <>
      <BackBar />
      <div className="head" style={{ paddingTop: 0 }}>
        <h1 className="title page">{title}</h1>
        {action}
      </div>
    </>
  );
}

export function Section({ label, right, children }: { label: string; right?: ReactNode; children: ReactNode }) {
  return (
    <>
      <div className="section-label">
        <span>{label}</span>
        {right && <span style={{ textTransform: 'none', letterSpacing: 0 }}>{right}</span>}
      </div>
      {children}
    </>
  );
}

/** Fetches the (authenticated) cached image as a blob and fades it in. Sized by aspect ratio so layout doesn't jump. */
export function ImageBlock({ image }: { image: ItemImage }) {
  const [loaded, setLoaded] = useState(false);
  const { data: src } = useQuery({
    queryKey: ['img', image.url],
    queryFn: () => fetchImageBlobUrl(image.url),
    enabled: image.status === 'ok',
    staleTime: Infinity,
    gcTime: 30 * 60_000,
  });
  const w = image.width ?? 2;
  const h = image.height ?? 3;
  const ratio = w / h;
  const width = ratio < 0.8 ? '58%' : ratio < 1.25 ? '70%' : '100%';
  return (
    <div className="img-block" style={{ width, aspectRatio: `${w} / ${h}`, opacity: loaded ? 1 : 0.5, transition: 'opacity .4s' }}>
      {src && <img src={src} alt="" className={loaded ? 'loaded' : ''} onLoad={() => setLoaded(true)} />}
    </div>
  );
}

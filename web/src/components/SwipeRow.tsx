import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { ListItem } from '../api';
import { catColor, formatAge, formatSize, haptic } from '../lib';

const SEND_THRESHOLD = 90;
const TAP_SLOP = 8;

interface Props {
  item: ListItem;
  onOpen: () => void;
  onSend: () => void;
  onHide: () => void;
}

interface Gesture {
  x: number;
  y: number;
  dragging: boolean;
  crossed: boolean;
}

export function SwipeRow({ item, onOpen, onSend, onHide }: Props) {
  const [dx, setDx] = useState(0);
  const [settle, setSettle] = useState(false);
  const g = useRef<Gesture | null>(null);
  const dxRef = useRef(0);
  const sent = item.state === 'sent';

  const move = (v: number) => {
    dxRef.current = v;
    setDx(v);
  };

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    g.current = { x: e.clientX, y: e.clientY, dragging: false, crossed: false };
    setSettle(false);
  };

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const s = g.current;
    if (!s) return;
    const ddx = e.clientX - s.x;
    const ddy = e.clientY - s.y;
    if (!s.dragging) {
      if (Math.abs(ddy) > TAP_SLOP && Math.abs(ddy) > Math.abs(ddx)) {
        g.current = null; // vertical scroll, not ours
        return;
      }
      if (Math.abs(ddx) <= TAP_SLOP) return;
      s.dragging = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    // Already-sent rows can't be sent again; resist rightward drag.
    const v = sent && ddx > 0 ? 0 : ddx;
    move(v);
    const past = Math.abs(v) > SEND_THRESHOLD;
    if (past && !s.crossed) haptic();
    s.crossed = past;
  };

  const finish = (e: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const s = g.current;
    g.current = null;
    if (!s) return;
    if (!s.dragging) {
      if (!cancelled) onOpen();
      return;
    }
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const v = dxRef.current;
    setSettle(true);
    move(0);
    if (cancelled) return;
    if (v > SEND_THRESHOLD && !sent) onSend();
    else if (v < -SEND_THRESHOLD) onHide();
  };

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen();
    }
  };

  const reveal = Math.min(1, Math.abs(dx) / SEND_THRESHOLD);
  const meta = [item.category, ...item.tags.slice(0, 3)].join(' · ');

  return (
    <div className="row-wrap">
      <div className="row-bg send" style={{ opacity: dx > 0 ? reveal : 0 }}>
        Download
      </div>
      <div className="row-bg hide" style={{ opacity: dx < 0 ? reveal : 0 }}>
        Hide
      </div>
      <div
        className={`row-fg${settle ? ' settle' : ''}`}
        role="button"
        tabIndex={0}
        style={{ transform: `translateX(${dx}px)` }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={(e) => finish(e, false)}
        onPointerCancel={(e) => finish(e, true)}
        onKeyDown={onKey}
        onTransitionEnd={() => setSettle(false)}
      >
        <div className="cat-bar" style={{ background: catColor(item.category) }} />
        <div className="row-main">
          <div className="row-title">{item.title}</div>
          <div className="row-meta">
            <span>{meta}</span>
            <span>{formatSize(item.size_bytes)}</span>
            <span>{formatAge(item.published_at)}</span>
          </div>
        </div>
        <div className="row-stats">
          <div className="seed">▲ {item.seeders}</div>
          <div className="leech">▼ {item.leechers}</div>
          {sent && <div className="sent-flag">Sent ✓</div>}
        </div>
      </div>
    </div>
  );
}

export function SkeletonRows({ count = 8 }: { count?: number }) {
  return (
    <div className="feed-card skeleton" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div className="row-wrap" key={i}>
          <div className="row-fg" style={{ cursor: 'default' }}>
            <div className="cat-bar" style={{ background: 'var(--chip)' }} />
            <div className="row-main">
              <div className="sk-line" style={{ width: `${70 + ((i * 13) % 25)}%` }} />
              <div className="sk-line" style={{ width: '45%', marginTop: 8, height: 10 }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

import { useEffect, useRef } from 'react';
import type { ListItem } from '../api';
import { useItemActions } from '../actions';
import { openItem, type Screen } from '../nav';
import { SwipeRow } from './SwipeRow';

interface Props {
  items: ListItem[];
  screen: Screen;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
}

/** Inset grouped card of swipeable rows with cursor-based infinite scroll. */
export function ItemList({ items, screen, hasNextPage, isFetchingNextPage, fetchNextPage }: Props) {
  const { send, hide } = useItemActions();
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage) return;
    const io = new IntersectionObserver((entries) => entries[0].isIntersecting && !isFetchingNextPage && fetchNextPage(), { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, items.length]);

  return (
    <>
      <div className="feed-card">
        {items.map((item) => (
          <SwipeRow key={item.id} item={item} onOpen={() => openItem(screen, item.id)} onSend={() => send(item)} onHide={() => hide(item)} />
        ))}
      </div>
      <div ref={sentinel} style={{ height: 1 }} />
      {isFetchingNextPage && <div className="empty" style={{ padding: 16 }}>Loading…</div>}
    </>
  );
}

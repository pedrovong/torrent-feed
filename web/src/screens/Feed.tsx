import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, itemsQuery, type ItemsPage, type Status } from '../api';
import { ItemList } from '../components/ItemList';
import { Menu, MenuButton } from '../components/Menu';
import { SkeletonRows } from '../components/SwipeRow';
import { Chips } from '../components/ui';
import { useToast } from '../components/Toast';
import { CATEGORIES } from '../lib';
import { navigate } from '../nav';

type Cat = (typeof CATEGORIES)[number];

function usePullToRefresh(onRefresh: () => Promise<unknown>) {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let startY = 0;
    let active = false;
    let cur = 0;
    const ts = (e: TouchEvent) => {
      if (window.scrollY <= 0 && !busy) {
        startY = e.touches[0].clientY;
        active = true;
      }
    };
    const tm = (e: TouchEvent) => {
      if (!active) return;
      const dy = e.touches[0].clientY - startY;
      cur = dy > 0 ? Math.min(80, dy * 0.5) : 0;
      setPull(cur);
    };
    const te = () => {
      if (!active) return;
      active = false;
      const triggered = cur >= 48;
      cur = 0;
      setPull(0);
      if (triggered) {
        setBusy(true);
        onRefresh().finally(() => setBusy(false));
      }
    };
    window.addEventListener('touchstart', ts, { passive: true });
    window.addEventListener('touchmove', tm, { passive: true });
    window.addEventListener('touchend', te);
    window.addEventListener('touchcancel', te);
    return () => {
      window.removeEventListener('touchstart', ts);
      window.removeEventListener('touchmove', tm);
      window.removeEventListener('touchend', te);
      window.removeEventListener('touchcancel', te);
    };
  }, [busy, onRefresh]);

  return { pull, busy };
}

export function Feed() {
  const [category, setCategory] = useState<Cat>('All');
  const [menuOpen, setMenuOpen] = useState(false);
  const [baseline, setBaseline] = useState<number | null>(null);
  const qc = useQueryClient();
  const toast = useToast();

  const feed = useInfiniteQuery({
    queryKey: ['items', 'feed', category],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api<ItemsPage>(
        itemsQuery({ state: 'new,sent', category: category === 'All' ? undefined : category, since_days: 7, limit: 50, cursor: pageParam }),
        { signal },
      ),
    getNextPageParam: (p) => p.next_cursor ?? undefined,
    staleTime: 15_000,
  });

  const status = useQuery({
    queryKey: ['status', baseline],
    queryFn: () => api<Status>(`/status${baseline ? `?since=${baseline}` : ''}`),
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (baseline === null && status.data) setBaseline(status.data.newest_created_at ?? 0);
  }, [baseline, status.data]);

  const refresh = useCallback(async () => {
    await feed.refetch();
    const s = await qc.fetchQuery({ queryKey: ['status', null], queryFn: () => api<Status>('/status'), staleTime: 0 });
    setBaseline(s.newest_created_at ?? 0);
  }, [feed, qc]);

  const { pull, busy } = usePullToRefresh(refresh);

  const pollNow = async () => {
    try {
      await api('/ingest/poll', { method: 'POST' });
      await refresh();
    } catch (e) {
      toast.show((e as Error).message);
    }
  };

  const items = feed.data?.pages.flatMap((p) => p.items) ?? [];
  const newCount = status.data?.new_since ?? 0;
  const err = feed.error as ApiError | null;

  return (
    <div className="screen">
      <div className="head">
        <h1 className="title feed">Today</h1>
        <MenuButton onClick={() => setMenuOpen(true)} />
      </div>
      <Menu open={menuOpen} current="feed" onClose={() => setMenuOpen(false)} />

      <Chips options={CATEGORIES} value={category} onChange={setCategory} />

      <div className="ptr" style={{ height: busy ? 32 : pull }}>
        {busy ? 'Refreshing…' : pull >= 48 ? 'Release to refresh' : pull > 0 ? 'Pull to refresh' : ''}
      </div>

      {newCount > 0 && (
        <div className="new-pill">
          <button
            onClick={() => {
              window.scrollTo({ top: 0, behavior: 'smooth' });
              void refresh();
            }}
          >
            {newCount} new
          </button>
        </div>
      )}

      {err && !feed.isFetching && (
        <div className="banner" role="alert">
          <div>
            <strong>{err.status === 401 ? 'Not signed in' : "Can't reach server"}</strong>
            <span className="sub">{err.status === 401 ? 'Check the API token in Settings.' : err.message}</span>
          </div>
          <button className="pill-btn" onClick={() => (err.status === 401 ? navigate('settings') : feed.refetch())}>
            {err.status === 401 ? 'Settings' : 'Retry'}
          </button>
        </div>
      )}

      <div className="pad">
        {feed.isPending && !err ? (
          <SkeletonRows />
        ) : items.length === 0 && !err ? (
          <div className="empty">
            <div>Nothing here.</div>
            <div style={{ fontSize: 13, marginTop: 6 }}>New items appear as your sources are polled.</div>
            <button className="pill-btn" style={{ marginTop: 14 }} onClick={pollNow}>
              Poll now
            </button>
          </div>
        ) : (
          <ItemList items={items} screen="feed" hasNextPage={!!feed.hasNextPage} isFetchingNextPage={feed.isFetchingNextPage} fetchNextPage={() => feed.fetchNextPage()} />
        )}
      </div>
    </div>
  );
}

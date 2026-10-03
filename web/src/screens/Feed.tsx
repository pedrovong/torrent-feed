import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, itemsQuery, type ItemsPage, type PollResponse, type Status } from '../api';
import { ItemList } from '../components/ItemList';
import { Menu, MenuButton } from '../components/Menu';
import { SkeletonRows } from '../components/SwipeRow';
import { useToast } from '../components/Toast';
import { navigate } from '../nav';
import { updateConfig, useConfig, type FeedSort, type SortOrder } from '../store';

const SORT_OPTIONS: Array<{ value: FeedSort; label: string; natural: SortOrder }> = [
  { value: 'date', label: 'Date', natural: 'desc' },
  { value: 'seeders', label: 'Seeders', natural: 'desc' },
  { value: 'leechers', label: 'Leechers', natural: 'desc' },
  { value: 'title', label: 'Title', natural: 'asc' },
];

export function Feed() {
  const { feedSort: sort, feedOrder: order } = useConfig();
  const [menuOpen, setMenuOpen] = useState(false);
  const [polling, setPolling] = useState(false);
  const [baseline, setBaseline] = useState<number | null>(null);
  const qc = useQueryClient();
  const toast = useToast();

  const feed = useInfiniteQuery({
    queryKey: ['items', 'feed', sort, order],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api<ItemsPage>(
        itemsQuery({ state: 'new,sent', sort, order, since_days: 7, limit: 50, cursor: pageParam }),
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

  // Poll every source now, reload the list, and tell the user what happened.
  const pollNow = async () => {
    if (polling) return;
    setPolling(true);
    try {
      const r = await api<PollResponse>('/ingest/poll', { method: 'POST' });
      await refresh();
      const failed = r.results.filter((x) => !x.ok);
      if (r.results.length === 0) toast.show('No enabled feeds to refresh');
      else if (failed.length === r.results.length) toast.show(`Refresh failed: ${failed[0].error ?? 'unknown error'}`);
      else {
        const msg = r.added > 0 ? `${r.added} new item${r.added === 1 ? '' : 's'} added` : 'No new items';
        toast.show(failed.length ? `${msg} (${failed.length} feed${failed.length === 1 ? '' : 's'} failed)` : msg);
      }
    } catch (e) {
      toast.show((e as Error).message);
    } finally {
      setPolling(false);
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
      <Menu open={menuOpen} current="feed" onClose={() => setMenuOpen(false)} onRefresh={() => void pollNow()} refreshing={polling} />

      <div className="sort-bar">
        <label className="sort-pick">
          <span>Sort</span>
          <select value={sort} onChange={(e) => {
              const next = SORT_OPTIONS.find((o) => o.value === e.target.value)!;
              updateConfig({ feedSort: next.value, feedOrder: next.natural });
            }} aria-label="Sort feed">
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="sort-dir"
          onClick={() => updateConfig({ feedOrder: order === 'asc' ? 'desc' : 'asc' })}
          aria-label={order === 'asc' ? 'Ascending, tap for descending' : 'Descending, tap for ascending'}
        >
          {order === 'asc' ? '↑' : '↓'}
        </button>
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

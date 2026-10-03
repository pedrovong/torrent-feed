import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, itemsQuery, type ItemsPage } from '../api';
import { ItemList } from '../components/ItemList';
import { SkeletonRows } from '../components/SwipeRow';
import { Chips, PageHeader } from '../components/ui';

const FILTERS = ['All sources', '1080p+', 'Seeds 50+', 'Last 7d'] as const;
type Filter = (typeof FILTERS)[number];

export function Search() {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [active, setActive] = useState<Filter[]>([]);

  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);

  const toggle = (f: Filter) => setActive((a) => (f === 'All sources' ? [] : a.includes(f) ? a.filter((x) => x !== f) : [...a, f]));
  const shown: Filter[] = active.length ? active : ['All sources'];

  const params = {
    q: q || undefined,
    state: 'new,sent',
    min_res: active.includes('1080p+') ? 1080 : undefined,
    min_seeders: active.includes('Seeds 50+') ? 50 : undefined,
    since_days: active.includes('Last 7d') ? 7 : undefined,
    limit: 50,
  };
  const enabled = !!q || active.length > 0;

  const res = useInfiniteQuery({
    queryKey: ['items', 'search', params],
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => api<ItemsPage>(itemsQuery({ ...params, cursor: pageParam }), { signal }),
    getNextPageParam: (p) => p.next_cursor ?? undefined,
  });

  const items = res.data?.pages.flatMap((p) => p.items) ?? [];
  const total = res.data?.pages[0]?.total;

  return (
    <div className="screen">
      <PageHeader title="Search" />
      <div className="search-wrap">
        <input
          className="input"
          type="search"
          autoFocus
          placeholder="Search titles"
          value={text}
          onChange={(e) => setText(e.target.value)}
          style={{ paddingRight: 36 }}
        />
        {text && (
          <button className="clear" aria-label="Clear" onClick={() => setText('')}>
            ✕
          </button>
        )}
      </div>
      <Chips options={FILTERS} value={shown} onChange={toggle} />

      <div className="pad">
        {!enabled ? (
          <div className="empty">Search every item the server has indexed.</div>
        ) : res.isPending ? (
          <SkeletonRows count={5} />
        ) : res.isError ? (
          <div className="empty">{(res.error as Error).message}</div>
        ) : (
          <>
            <div className="hint" style={{ margin: '0 4px 8px' }}>
              {total} result{total === 1 ? '' : 's'} in backend database
            </div>
            {items.length === 0 ? (
              <div className="empty">No matches.</div>
            ) : (
              <ItemList items={items} screen="search" hasNextPage={!!res.hasNextPage} isFetchingNextPage={res.isFetchingNextPage} fetchNextPage={() => res.fetchNextPage()} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

import { useQueryClient, type InfiniteData, type QueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { api, ApiError, type ItemDetail, type ItemsPage, type ItemState } from './api';
import { useToast } from './components/Toast';

type Patch = { state: ItemState } | 'remove';

function patchItem(qc: QueryClient, id: number, p: Patch) {
  qc.setQueriesData<InfiniteData<ItemsPage>>({ queryKey: ['items'] }, (old) => {
    if (!old) return old;
    return {
      ...old,
      pages: old.pages.map((pg) => ({
        ...pg,
        items: p === 'remove' ? pg.items.filter((i) => i.id !== id) : pg.items.map((i) => (i.id === id ? { ...i, ...p } : i)),
      })),
    };
  });
  qc.setQueryData<ItemDetail>(['item', id], (d) => (d ? { ...d, state: p === 'remove' ? 'hidden' : p.state } : d));
}

export interface ActionTarget {
  id: number;
  state: ItemState;
}

/** Optimistic send/hide with Undo. Server is the source of truth; failures roll back. */
export function useItemActions() {
  const qc = useQueryClient();
  const toast = useToast();

  const refresh = () => qc.invalidateQueries({ queryKey: ['items'] });

  const send = useCallback(
    async (item: ActionTarget, opts: { download_dir?: string } = {}): Promise<boolean> => {
      const prev = item.state;
      patchItem(qc, item.id, { state: 'sent' });
      try {
        await api(`/items/${item.id}/download`, { method: 'POST', body: opts });
      } catch (e) {
        patchItem(qc, item.id, { state: prev });
        const err = e as ApiError;
        toast.show(err.code === 'client_not_configured' ? 'Set up Transmission in Settings first' : `Send failed: ${err.message}`);
        return false;
      }
      toast.show('Sent to Transmission', {
        label: 'Undo',
        run: async () => {
          patchItem(qc, item.id, { state: 'new' });
          try {
            await api(`/items/${item.id}/restore?remove_from_client=1`, { method: 'POST' });
          } catch {
            toast.show("Couldn't undo");
          }
          refresh();
        },
      });
      return true;
    },
    [qc, toast],
  );

  const hide = useCallback(
    async (item: ActionTarget): Promise<boolean> => {
      patchItem(qc, item.id, 'remove');
      try {
        await api(`/items/${item.id}/hide`, { method: 'POST' });
      } catch (e) {
        refresh();
        toast.show(`Hide failed: ${(e as Error).message}`);
        return false;
      }
      toast.show('Hidden', {
        label: 'Undo',
        run: async () => {
          try {
            await api(`/items/${item.id}/restore`, { method: 'POST' });
          } catch {
            toast.show("Couldn't undo");
          }
          refresh();
        },
      });
      return true;
    },
    [qc, toast],
  );

  return { send, hide };
}

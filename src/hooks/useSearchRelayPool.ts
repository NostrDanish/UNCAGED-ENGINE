/**
 * Search relay pool hook — React state over the search relay pool
 * (app defaults + user customs), with latency testing:
 * ping each relay with a tiny query and time the round-trip.
 *
 * The pool is fully user-editable: customs can be added, and ANY relay —
 * default included — can be removed. Removed defaults can be restored
 * with restoreDefaults().
 */
import { useCallback, useState } from 'react';

import {
  addSearchRelay,
  removeSearchRelay,
  restoreDefaultSearchRelays,
  getRemovedSearchRelays,
  getSearchRelayUrls,
  isDefaultSearchRelay,
} from '@/lib/appRelays';
import { getSearchRelay } from '@/lib/searchRelays';

export type SearchRelayOrigin = 'default' | 'custom';
export type SearchRelayStatus = 'untested' | 'testing' | 'ok' | 'error';

export interface SearchRelayEntry {
  url: string;
  origin: SearchRelayOrigin;
  status: SearchRelayStatus;
  latencyMs?: number;
}

function buildPool(): SearchRelayEntry[] {
  return getSearchRelayUrls().map((url): SearchRelayEntry => ({
    url,
    origin: isDefaultSearchRelay(url) ? 'default' : 'custom',
    status: 'untested',
  }));
}

export function useSearchRelayPool() {
  const [pool, setPool] = useState<SearchRelayEntry[]>(buildPool);
  const [testing, setTesting] = useState(false);
  // Defaults the user has removed — drives the "Restore defaults" affordance.
  const [removedCount, setRemovedCount] = useState(() => getRemovedSearchRelays().length);

  const addRelay = useCallback((input: string): { url: string; origin: 'default' | 'custom' } | null => {
    const added = addSearchRelay(input);
    if (added) {
      setPool(buildPool());
      setRemovedCount(getRemovedSearchRelays().length);
    }
    return added;
  }, []);

  const removeRelay = useCallback((url: string) => {
    removeSearchRelay(url);
    setPool(buildPool());
    setRemovedCount(getRemovedSearchRelays().length);
  }, []);

  const restoreDefaults = useCallback(() => {
    restoreDefaultSearchRelays();
    setPool(buildPool());
    setRemovedCount(0);
  }, []);

  /** Ping every relay with a limit-1 query and record latency/status. */
  const testRelays = useCallback(async () => {
    setTesting(true);
    setPool((prev) => prev.map((r) => ({ ...r, status: 'testing' as const })));

    await Promise.allSettled(
      pool.map(async (entry) => {
        const start = performance.now();
        try {
          const relay = getSearchRelay(entry.url);
          await relay.query([{ kinds: [1], limit: 1 }], {
            signal: AbortSignal.timeout(5000),
          });
          const latencyMs = Math.round(performance.now() - start);
          setPool((prev) =>
            prev.map((r) =>
              r.url === entry.url ? { ...r, status: 'ok' as const, latencyMs } : r,
            ),
          );
        } catch {
          setPool((prev) =>
            prev.map((r) =>
              r.url === entry.url ? { ...r, status: 'error' as const, latencyMs: undefined } : r,
            ),
          );
        }
      }),
    );

    setTesting(false);
  }, [pool]);

  return { pool, testing, testRelays, addRelay, removeRelay, restoreDefaults, removedCount };
}

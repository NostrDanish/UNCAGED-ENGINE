/**
 * Index stats hooks — power the Admin console's Stats tab.
 *
 * Small read-only counters over the search relay pool: recent SIP-01
 * observations (kind 39697) and community submissions (kind 30078).
 */
import { useQuery } from '@tanstack/react-query';
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import { getSearchRelayUrls } from '@/lib/appRelays';
import { queryRelayPool } from '@/lib/searchRelays';
import { WEB_INDEX_KIND } from '@/lib/webIndex';
import { COMMUNITY_KIND, COMMUNITY_T_TAG } from '@/lib/communityIndex';

/** Fetch + merge events from the whole search relay pool (deduped by id). */
async function poolQuery(filters: NostrFilter[], signal: AbortSignal): Promise<NostrEvent[]> {
  const settled = await queryRelayPool(getSearchRelayUrls(), filters, { signal });
  const events = new Map<string, NostrEvent>();
  for (const value of settled) {
    for (const ev of value) {
      if (!events.has(ev.id)) events.set(ev.id, ev);
    }
  }
  return [...events.values()];
}

/** Recent SIP-01 web index observations (deduped by document d-tag). */
export function useRecentIndexedDocs(limit = 200) {
  return useQuery({
    queryKey: ['recent-indexed-docs', limit],
    queryFn: async ({ signal }) => {
      const events = await poolQuery([{ kinds: [WEB_INDEX_KIND], limit }], signal);
      // Group by d — one document per d-tag regardless of indexer count.
      const byDoc = new Map<string, NostrEvent>();
      for (const ev of events) {
        const d = ev.tags.find(([n]) => n === 'd')?.[1];
        if (!d) continue;
        const existing = byDoc.get(d);
        if (!existing || ev.created_at > existing.created_at) byDoc.set(d, ev);
      }
      return [...byDoc.values()].sort((a, b) => b.created_at - a.created_at);
    },
    staleTime: 60_000,
    retry: 1,
  });
}

/** Recent community index submissions (kind 30078, uncaged-submit). */
export function useCommunitySubmissions(limit = 200) {
  return useQuery({
    queryKey: ['community-submissions', limit],
    queryFn: async ({ signal }) => {
      const events = await poolQuery(
        [{ kinds: [COMMUNITY_KIND], '#t': [COMMUNITY_T_TAG], limit }],
        signal,
      );
      return events.sort((a, b) => b.created_at - a.created_at);
    },
    staleTime: 60_000,
    retry: 1,
  });
}

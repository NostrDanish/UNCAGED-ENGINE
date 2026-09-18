/**
 * Community Index provider — user-curated search results from Nostr.
 *
 * Any logged-in Nostr user can submit a link (Submit button in the header).
 * Submissions are kind 30078 addressable events signed by the user's own key
 * (schema in src/lib/communityIndex.ts, documented in NIP.md).
 *
 * Relays can't full-text search arbitrary tags, so recent submissions are
 * fetched by `#t` tag and filtered client-side against the query terms
 * (AND match across title, description, tags, and URL).
 */
import type { NostrEvent, NostrFilter } from '@nostrify/nostrify';

import { getSearchRelayUrls } from '@/lib/appRelays';
import { getSearchRelay } from '@/lib/searchRelays';
import { COMMUNITY_KIND, COMMUNITY_T_TAG, parseSubmissionEvent } from '@/lib/communityIndex';
import { parseQuery } from '@/lib/queryParser';
import { matchesDoc } from '@/lib/queryEval';
import type { SearchProvider, SearchOptions, ProviderSearchResponse, SearchResult } from './types';

/** How many recent events to pull before client-side filtering. */
const FETCH_LIMIT = 150;

/** Does this result satisfy the (structured) query? */
function matchesQuery(result: SearchResult, parsed: ReturnType<typeof parseQuery>): boolean {
  return matchesDoc(parsed, {
    title: result.title,
    description: result.snippet,
    url: result.url,
    topics: result.tags ?? [],
    observedAt: result.timestamp,
  });
}

export const communityProvider: SearchProvider = {
  id: 'community',
  name: 'Community',
  source: 'web',

  async search({ query, signal }: SearchOptions): Promise<ProviderSearchResponse> {
    if (!query.trim()) return { results: [] };

    const filters: NostrFilter[] = [
      { kinds: [COMMUNITY_KIND], '#t': [COMMUNITY_T_TAG], limit: FETCH_LIMIT },
    ];

    const settled = await Promise.allSettled(
      getSearchRelayUrls().map(async (url) => {
        const relay = getSearchRelay(url);
        return relay.query(filters, {
          signal: AbortSignal.any([signal ?? AbortSignal.timeout(10000), AbortSignal.timeout(6000)]),
        });
      }),
    );

    // Merge events by id (same event may arrive from multiple relays).
    const events = new Map<string, NostrEvent>();
    for (const r of settled) {
      if (r.status !== 'fulfilled') continue;
      for (const ev of r.value) {
        if (!events.has(ev.id)) events.set(ev.id, ev);
      }
    }

    const parsed = parseQuery(query);

    // Parse, dedupe by URL (keep newest), filter by query, sort by recency.
    const byUrl = new Map<string, SearchResult>();
    for (const ev of events.values()) {
      const result = parseSubmissionEvent(ev);
      if (!result || !matchesQuery(result, parsed)) continue;
      const key = result.url.toLowerCase();
      const existing = byUrl.get(key);
      if (!existing || (result.timestamp ?? 0) > (existing.timestamp ?? 0)) {
        byUrl.set(key, result);
      }
    }

    return {
      results: [...byUrl.values()].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0)).slice(0, 20),
    };
  },
};

/**
 * Auto-indexing hook — contributes web pages discovered during searches to
 * the shared Nostr web index (Search Index Protocol, SIP-01 — see
 * docs/SIP-01.md and src/lib/webIndex.ts).
 *
 * What it publishes: one kind 39697 addressable event per unique URL,
 * containing only the page's public metadata (title, description, tags).
 *
 * Where discoveries come from:
 *   - Nostr-native results that REFERENCE a web page (SearchResult.webUrl):
 *     kind 1063 file metadata (rich: author-provided title + description)
 *     and http(s) links cited in notes/articles (discovery-layer: host
 *     title, no description — we have not fetched the page);
 *   - http(s) results from any external provider you add
 *     (see README → "Adding a provider");
 *   - community submissions are dual-published by the Submit dialog
 *     (src/components/SubmitToIndex.tsx), not here.
 *
 * What it NEVER publishes:
 *   - the search query (no query text, no correlation between user and URL);
 *   - the user's personal Nostr identity (events are signed by this device's
 *     dedicated indexing identity — see src/lib/indexerIdentity.ts);
 *   - results that already came out of the index (web-index / community) —
 *     re-indexing them would be a no-op echo loop;
 *   - Nostr content itself (notes/articles live on relays already — only
 *     the web pages they point at are indexed).
 *
 * Every browser is an independent indexer — there is no central signing key.
 * Indexer keys are pseudonymous and replaceable; network observers may still
 * correlate IP/timing (key separation, not network anonymity — spec §16).
 */
import { useCallback, useRef } from 'react';

import type { SearchResult } from '@/lib/providers/types';
import {
  normalizeIndexUrl,
  observationFromNostrResult,
  observationFromResult,
  type IndexObservationInput,
} from '@/lib/webIndex';
import { publishIndexObservation } from '@/lib/indexPublisher';
import { useAppContext } from '@/hooks/useAppContext';

/** Max document observations published per search. */
const MAX_OBSERVATIONS_PER_SEARCH = 10;

/** Providers that read the index itself — their results are never re-indexed. */
const INDEX_SOURCED_PROVIDERS = new Set(['web-index', 'community']);

/**
 * Decide what (if anything) a result contributes to the index.
 * Returns the observation input, or null for unindexable results.
 */
function observationFor(result: SearchResult): IndexObservationInput | null {
  // Echo-loop prevention: results the index already produced.
  if (INDEX_SOURCED_PROVIDERS.has(result.provider)) return null;

  // Nostr-native content: index the web page it REFERENCES, if any.
  if (result.source === 'nostr') {
    return result.webUrl ? observationFromNostrResult(result) : null;
  }

  // External providers (added by you): fresh web pages.
  return observationFromResult(result);
}

/**
 * Hook: auto-indexes search results to Nostr.
 * Returns a function to call after a search completes.
 */
export function useSearchIndexer() {
  const { config } = useAppContext();
  const autoIndex = config.autoIndex;
  // Track which URLs we've indexed this session.
  const indexedDocsRef = useRef(new Set<string>());

  const indexResults = useCallback(async (_query: string, results: SearchResult[]) => {
    if (!autoIndex) return;

    // Unique, indexable web URLs from this search — deduped by normalized URL.
    const seen = new Set<string>();
    const observations: IndexObservationInput[] = [];
    for (const result of results) {
      const input = observationFor(result);
      if (!input) continue;

      const normalized = normalizeIndexUrl(input.url);
      if (!normalized || seen.has(normalized) || indexedDocsRef.current.has(normalized)) continue;
      seen.add(normalized);

      observations.push({ ...input, url: normalized });
      if (observations.length >= MAX_OBSERVATIONS_PER_SEARCH) break;
    }
    if (observations.length === 0) return;

    // Optimistically mark before async work so repeat searches don't republish.
    for (const input of observations) {
      indexedDocsRef.current.add(input.url);
    }

    for (const input of observations) {
      try {
        await publishIndexObservation(input);
      } catch {
        // Indexing failure is non-fatal — unmark so a later search can retry.
        indexedDocsRef.current.delete(input.url);
      }
    }
  }, [autoIndex]);

  return { indexResults };
}

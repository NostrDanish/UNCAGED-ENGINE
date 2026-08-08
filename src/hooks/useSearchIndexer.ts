/**
 * Auto-indexing hook — contributes useful web results discovered during
 * searches to the shared Nostr web index (Search Index Protocol, SIP-01 —
 * see docs/SEARCH_INDEX_PROTOCOL.md and src/lib/webIndex.ts).
 *
 * What it publishes: one kind 39697 addressable event per unique URL,
 * containing only the page's public metadata (title, description, tags).
 *
 * What it NEVER publishes:
 *   - the search query (no query text, no correlation between user and URL);
 *   - the user's personal Nostr identity (events are signed by this device's
 *     dedicated indexing identity — see src/lib/indexerIdentity.ts);
 *   - Nostr-native results (they already live on relays);
 *   - results that already came out of the index (web-index / community) —
 *     re-indexing them would be a no-op echo loop.
 *
 * Every browser is an independent indexer — there is no central signing key.
 * Indexer keys are pseudonymous and replaceable; network observers may still
 * correlate IP/timing (key separation, not network anonymity — spec §14).
 *
 * Out of the box this template's only web results come FROM the index, so
 * auto-indexing stays quiet until you add a provider that discovers fresh
 * web pages (see README → "Adding a provider"). The machinery is complete
 * and ready: any new provider's http(s) results are indexed automatically.
 */
import { useCallback, useRef } from 'react';
import { finalizeEvent } from 'nostr-tools/pure';

/* Local hex helpers — avoid bundler ambiguity around @noble/hashes subpath
 * resolution (the identity module does the same). */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

import type { NostrEvent } from '@nostrify/nostrify';

import type { SearchResult } from '@/lib/providers/types';
import { getIndexerIdentity } from '@/lib/indexerIdentity';
import { buildIndexEvent, normalizeIndexUrl, observationFromResult } from '@/lib/webIndex';
import { getSearchRelayUrls } from '@/lib/appRelays';
import { getSearchRelay } from '@/lib/searchRelays';
import { useAppContext } from '@/hooks/useAppContext';

/** Max document observations published per search. */
const MAX_OBSERVATIONS_PER_SEARCH = 10;

/** Providers whose results are already on Nostr — never re-indexed. */
const NOSTR_NATIVE_PROVIDERS = new Set(['nostr', 'web-index', 'community']);

/** Publish a signed event to every search relay (best-effort). */
async function publishObservation(signedEvent: NostrEvent) {
  await Promise.allSettled(
    getSearchRelayUrls().map((url) => getSearchRelay(url).event(signedEvent)),
  );
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
    const observations = [];
    for (const result of results) {
      if (result.source === 'nostr' || NOSTR_NATIVE_PROVIDERS.has(result.provider)) continue;
      const normalized = normalizeIndexUrl(result.url);
      if (!normalized || seen.has(normalized) || indexedDocsRef.current.has(normalized)) continue;
      seen.add(normalized);

      const input = observationFromResult(result);
      if (!input) continue;
      observations.push(input);
      if (observations.length >= MAX_OBSERVATIONS_PER_SEARCH) break;
    }
    if (observations.length === 0) return;

    // Optimistically mark before async work so repeat searches don't republish.
    for (const input of observations) {
      const normalized = normalizeIndexUrl(input.url);
      if (normalized) indexedDocsRef.current.add(normalized);
    }

    const identity = getIndexerIdentity();
    const secretKey = hexToBytes(identity.secretHex);
    const pubkeyHex = identity.pubkeyHex;

    for (const input of observations) {
      try {
        const template = await buildIndexEvent(input);
        if (!template) continue;
        const signedEvent = finalizeEvent(
          {
            kind: template.kind,
            created_at: Math.floor(Date.now() / 1000),
            tags: template.tags,
            content: template.content,
            pubkey: pubkeyHex,
          },
          secretKey,
        );
        await publishObservation(signedEvent);
      } catch {
        // Indexing failure is non-fatal — unmark so a later search can retry.
        const normalized = normalizeIndexUrl(input.url);
        if (normalized) indexedDocsRef.current.delete(normalized);
      }
    }
  }, [autoIndex]);

  return { indexResults };
}

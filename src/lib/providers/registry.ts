/**
 * Provider registry — central catalog of all search providers.
 *
 * Add a new provider:
 *   1. Create `src/lib/providers/my-provider.ts` implementing `SearchProvider`
 *   2. Import it here and add it to `ALL_PROVIDERS`
 *   3. Done — the orchestrator picks it up automatically
 *
 * The three providers below are the pure core of the engine:
 *   - web-index: the shared decentralized document index (SIP-01, kind 39697)
 *   - nostr:     live NIP-50 full-text search across search relays
 *   - community: user-curated link submissions (kind 30078)
 */
import type { SearchProvider, SearchSource } from './types';
import { webIndexProvider } from './web-index';
import { nostrProvider } from './nostr';
import { communityProvider } from './community';

/**
 * All registered search providers, in priority order.
 *
 * The web index runs first — if the pages were indexed before, results come
 * from Nostr instantly. All providers still run in parallel; their results
 * get merged + deduped by the orchestrator.
 */
export const ALL_PROVIDERS: SearchProvider[] = [
  webIndexProvider,
  nostrProvider,
  communityProvider,
];

/** Get providers that contribute to a given source tab. */
export function getProvidersForSource(source: SearchSource | 'all'): SearchProvider[] {
  if (source === 'all') return ALL_PROVIDERS;
  return ALL_PROVIDERS.filter((p) => p.source === source || p.additionalSources?.includes(source));
}

/** Get a provider by ID. */
export function getProvider(id: string): SearchProvider | undefined {
  return ALL_PROVIDERS.find((p) => p.id === id);
}

/** All unique source categories from registered providers. */
export function getAvailableSources(): SearchSource[] {
  const sources = new Set<SearchSource>();
  for (const p of ALL_PROVIDERS) sources.add(p.source);
  return [...sources];
}

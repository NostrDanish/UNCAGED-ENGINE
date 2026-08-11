/**
 * Universal search provider interface — the heart of the engine.
 *
 * Every source of results (Nostr relays, the shared web index, the community
 * index, or anything you add) implements the same `SearchProvider` interface
 * and returns the same `SearchResult[]`. The orchestrator
 * (`useProviderSearch`) runs all providers in parallel, then merges,
 * deduplicates, and ranks their results.
 *
 * To add a provider: implement this interface and register it in
 * `src/lib/providers/registry.ts`. See README.md → "Adding a provider".
 */

/** The source category a result belongs to (drives tabs + badges). */
export type SearchSource = 'nostr' | 'web';

/** A universal search result from any provider. */
export interface SearchResult {
  /** Unique key for deduplication. Usually a URL or event ID. */
  id: string;
  /** Display title. */
  title: string;
  /** URL to link to (can be a /:nip19 internal route for Nostr events). */
  url: string;
  /** Short text snippet / description. */
  snippet: string;
  /** Source category for tab filtering and UI badges. */
  source: SearchSource;
  /** Provider ID that produced this result (e.g. 'nostr', 'web-index'). */
  provider: string;
  /** Unix timestamp of the result content (if known). */
  timestamp?: number;
  /** Author display name. */
  author?: string;
  /** Author avatar URL (sanitized). */
  authorAvatar?: string;
  /** Domain or relay hostname shown as breadcrumb. */
  domain?: string;
  /** Optional thumbnail / image URL. */
  thumbnail?: string;
  /** Sub-type label (e.g. "Profile", "Article", "Note"). */
  kind?: string;
  /** Engine / source name for attribution (e.g. "Web Index", "Community"). */
  engine?: string;
  /** Extra tags for rendering (hashtags, badges, etc.). */
  tags?: string[];
  /** Original Nostr event data if applicable. */
  nostrEvent?: import('@nostrify/nostrify').NostrEvent;
  /**
   * External web URL referenced by this result, when the result itself is
   * Nostr-native (internal /:nip19 `url`) but points at a web document —
   * e.g. a kind 1063 file's `url` tag, or a link cited in a note's content.
   * The auto-indexer indexes this URL into the SIP-01 web index.
   */
  webUrl?: string;
  /** Score used for ranking (higher = better). */
  score?: number;
}

/** Options passed to every provider search call. */
export interface SearchOptions {
  /** The user's search query. */
  query: string;
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
  /** Maximum number of results to return. */
  limit?: number;
}

/** The result of a provider search call. */
export interface ProviderSearchResponse {
  /** The results returned by the provider. */
  results: SearchResult[];
  /** Optional search suggestions for related queries. */
  suggestions?: string[];
}

/**
 * A search provider that can be registered with the orchestrator.
 *
 * Every provider in this template talks to Nostr relays only — the user's
 * query never leaves the Nostr network. If you add a provider that calls a
 * clearnet API or a proxy, say so honestly in the UI (see README → Privacy).
 */
export interface SearchProvider {
  /** Unique provider ID (e.g. 'nostr', 'web-index'). */
  id: string;
  /** Human-readable name (shown in the live status indicators). */
  name: string;
  /** Source category this provider contributes to. */
  source: SearchSource;
  /**
   * Extra source tabs this provider also runs under. E.g. a community
   * provider that is primarily 'web' could also run under another tab.
   */
  additionalSources?: SearchSource[];
  /** Execute the search. */
  search(options: SearchOptions): Promise<ProviderSearchResponse>;
}

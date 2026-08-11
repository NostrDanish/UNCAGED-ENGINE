import type { RelayMetadata } from '@/contexts/AppContext';

/**
 * App default relays. Used as the initial `relayMetadata` for new users and as
 * a fallback when the user has no NIP-65 relay list configured (e.g. during
 * nostrconnect handshakes before any user relays have been loaded).
 *
 * These are only the INITIAL value — users edit their NIP-65 list freely in
 * Settings → Your Relays (synced as kind 10002 when logged in).
 */
export const APP_RELAYS: RelayMetadata = {
  relays: [
    { url: 'wss://relay.ditto.pub/', read: true, write: true },
    { url: 'wss://relay.nostr.band/', read: true, write: false },
    { url: 'wss://relay.primal.net/', read: false, write: true },
    { url: 'wss://relay.damus.io/', read: false, write: true },
  ],
  updatedAt: 0,
};

/**
 * The default search relay pool — queried in parallel for every search
 * (Nostr NIP-50 content search, the SIP-01 web index, and the community
 * index), and the first publish target for index observations.
 *
 * The first group is the SIP-01 index network — the relays the crawlers
 * (Crawlstr et al.) publish kind 39697 observations to, including the
 * validating UNCAGED Index Relay and a Tor onion relay (reachable for
 * Tor Browser users; harmlessly unreachable elsewhere — failures are
 * tolerated per-relay). The second group carries NIP-50 full-text search
 * over general Nostr content (notes, profiles, articles).
 *
 * Users can add their own relays AND remove any default in
 * Settings → Search Relays (both stored locally).
 */
export const SEARCH_RELAYS = [
  // ── SIP-01 index network (web index + community index) ──
  'wss://relay-na1.metanomalist.com/', // UNCAGED Index Relay (validating, SIP-01-aware)
  'wss://relay.ditto.pub/',
  'wss://jskitty.cat/nostr',
  'ws://acuy3mjnv26tkyaaucndlxmg2ocntz4rtebhavk57vgruozm42iaznqd.onion/', // Tor access point
  'wss://search.nos.today/',
  'wss://relay.primal.net/',
  'wss://nostr.hifish.org/',
  // ── NIP-50 full-text relays (Nostr content search) ──
  'wss://relay.nostr.band/',
  'wss://relay.noswhere.com/',
];

/* ------------------------------------------------------------------ */
/* Search relay customization (localStorage)                           */
/*                                                                     */
/* The pool is fully user-editable: customs are appended, and ANY       */
/* default can be removed (a "removed defaults" list is kept, so a      */
/* factory reset is always one click away).                             */
/* ------------------------------------------------------------------ */

const LS_CUSTOM_SEARCH_RELAYS = 'uncaged:search-relays:custom';
const LS_REMOVED_SEARCH_RELAYS = 'uncaged:search-relays:removed';

function readList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed.filter((u): u is string => typeof u === 'string') : [];
  } catch {
    return [];
  }
}

function writeList(key: string, urls: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(urls));
  } catch {
    // Storage unavailable — non-fatal.
  }
}

/** Normalize a relay URL: ws/wss only, with trailing slash (matches SEARCH_RELAYS style). */
export function normalizeRelayUrl(input: string): string | null {
  let url = input.trim();
  if (!url) return null;
  if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
    url = `wss://${url}`;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'wss:' && parsed.protocol !== 'ws:') return null;
    // Canonical form: origin + pathname, trailing slash on bare hosts.
    const path = parsed.pathname === '/' ? '/' : parsed.pathname;
    return `${parsed.protocol}//${parsed.host}${path}`;
  } catch {
    return null;
  }
}

/** Is this URL one of the built-in default search relays? */
export function isDefaultSearchRelay(url: string): boolean {
  return (SEARCH_RELAYS as readonly string[]).includes(url);
}

/** The user's custom search relays. */
export function getCustomSearchRelays(): string[] {
  return readList(LS_CUSTOM_SEARCH_RELAYS);
}

/** Default relays the user has removed. */
export function getRemovedSearchRelays(): string[] {
  return readList(LS_REMOVED_SEARCH_RELAYS).filter(isDefaultSearchRelay);
}

/**
 * Add a relay to the pool. Re-adding a removed default RESTORES it
 * (it keeps its "default" origin) instead of duplicating it as a custom.
 * Returns { url, origin } on success, null for invalid URLs.
 */
export function addSearchRelay(input: string): { url: string; origin: 'default' | 'custom' } | null {
  const normalized = normalizeRelayUrl(input);
  if (!normalized) return null;

  if (isDefaultSearchRelay(normalized)) {
    writeList(
      LS_REMOVED_SEARCH_RELAYS,
      getRemovedSearchRelays().filter((u) => u !== normalized),
    );
    return { url: normalized, origin: 'default' };
  }

  const customs = readList(LS_CUSTOM_SEARCH_RELAYS);
  if (!customs.includes(normalized)) {
    writeList(LS_CUSTOM_SEARCH_RELAYS, [...customs, normalized]);
  }
  return { url: normalized, origin: 'custom' };
}

/** Remove a relay from the pool — works for defaults and customs alike. */
export function removeSearchRelay(url: string): void {
  if (isDefaultSearchRelay(url)) {
    const removed = getRemovedSearchRelays();
    if (!removed.includes(url)) writeList(LS_REMOVED_SEARCH_RELAYS, [...removed, url]);
    return;
  }
  writeList(LS_CUSTOM_SEARCH_RELAYS, readList(LS_CUSTOM_SEARCH_RELAYS).filter((u) => u !== url));
}

/** Restore every removed default relay (customs are kept). */
export function restoreDefaultSearchRelays(): void {
  writeList(LS_REMOVED_SEARCH_RELAYS, []);
}

/**
 * The effective search relay pool: default relays (minus user removals)
 * first, then the user's custom relays (deduped).
 */
export function getSearchRelayUrls(): string[] {
  const removed = new Set(getRemovedSearchRelays());
  const seen = new Set<string>();
  const pool: string[] = [];
  for (const url of [...SEARCH_RELAYS, ...readList(LS_CUSTOM_SEARCH_RELAYS)]) {
    if (removed.has(url) || seen.has(url)) continue;
    seen.add(url);
    pool.push(url);
  }
  return pool;
}

/* ------------------------------------------------------------------ */
/* Index publishing                                                     */
/* ------------------------------------------------------------------ */

/**
 * Extra relays that index observations (SIP-01, kind 39697) are published
 * to, beyond the search pool. These are well-known public relays that
 * reliably accept writes, so observations propagate widely (search relays
 * pick them up from here over time).
 */
export const INDEX_WRITE_RELAYS = [
  'wss://relay.ditto.pub/',
  'wss://relay.primal.net/',
  'wss://relay.damus.io/',
];

/**
 * Relays that index observations are published to: the search pool first
 * (so the Web Index provider sees fresh observations immediately and the
 * SIP-01 index network gets them at the door), then the write relays (so
 * they replicate across the network). Deduped.
 */
export function getIndexPublishRelays(): string[] {
  const seen = new Set<string>();
  const pool: string[] = [];
  for (const url of [...getSearchRelayUrls(), ...INDEX_WRITE_RELAYS]) {
    if (!seen.has(url)) {
      seen.add(url);
      pool.push(url);
    }
  }
  return pool;
}

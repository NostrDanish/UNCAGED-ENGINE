import type { RelayMetadata } from '@/contexts/AppContext';
import { getDiscoveredIndexRelays, getDiscoveredSearchRelays } from '@/lib/relayDiscovery';

/**
 * Relay layout model (conceptual map — the concrete pools below):
 *
 *   indexRead    — where SIP-01 observations + community submissions are
 *                  read from, and where NIP-50 content search fans out
 *                  (SEARCH_RELAYS + user customs + NIP-11-verified
 *                  discovered relays).
 *   indexWrite   — extra public write relays that index observations are
 *                  ALSO published to for propagation (INDEX_WRITE_RELAYS).
 *   control      — where moderation labels, role lists, reports, and
 *                  referral/affiliate control events live
 *                  (getModerationRelayUrls(): the index pool + the owner's
 *                  NIP-65 defaults).
 *   fallback     — the user's NIP-65 relay list (APP_RELAYS defaults) —
 *                  login/profile/submission transport, never search fan-out.
 *
 * Every relay in every pool has a reason for being there; user overrides
 * (custom adds + removable defaults) apply per-pool via localStorage.
 */

/**
 * App default relays (the fallback/control layer). Used as the initial
 * `relayMetadata` for new users and as a fallback when the user has no
 * NIP-65 relay list configured (e.g. during nostrconnect handshakes before
 * any user relays have been loaded).
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

/** Raw removed relay URLs (defaults AND hidden discovered relays). */
function getRawRemovedSearchRelays(): string[] {
  return readList(LS_REMOVED_SEARCH_RELAYS);
}

/** Default relays the user has removed (drives the "Restore defaults" affordance). */
export function getRemovedSearchRelays(): string[] {
  return getRawRemovedSearchRelays().filter(isDefaultSearchRelay);
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

/** Remove a relay from the pool — works for defaults, customs, and discovered relays alike. */
export function removeSearchRelay(url: string): void {
  if (isDefaultSearchRelay(url)) {
    const removed = getRawRemovedSearchRelays();
    if (!removed.includes(url)) writeList(LS_REMOVED_SEARCH_RELAYS, [...removed, url]);
    return;
  }
  if (readList(LS_CUSTOM_SEARCH_RELAYS).includes(url)) {
    writeList(LS_CUSTOM_SEARCH_RELAYS, readList(LS_CUSTOM_SEARCH_RELAYS).filter((u) => u !== url));
    return;
  }
  // Discovered relay — hide it via the removed list.
  const removed = getRawRemovedSearchRelays();
  if (!removed.includes(url)) writeList(LS_REMOVED_SEARCH_RELAYS, [...removed, url]);
}

/** Restore every removed DEFAULT relay (customs + hidden discovered relays are kept). */
export function restoreDefaultSearchRelays(): void {
  writeList(LS_REMOVED_SEARCH_RELAYS, getRawRemovedSearchRelays().filter((u) => !isDefaultSearchRelay(u)));
}

/**
 * The effective search relay pool (indexRead): default relays (minus user
 * removals), then the user's custom relays, then NIP-11-verified discovered
 * relays (deduped). Discovery is additive only — the defaults keep working
 * with an empty discovery cache.
 */
export function getSearchRelayUrls(): string[] {
  const removed = new Set(getRawRemovedSearchRelays());
  const seen = new Set<string>();
  const pool: string[] = [];
  for (const url of [...SEARCH_RELAYS, ...readList(LS_CUSTOM_SEARCH_RELAYS), ...getDiscoveredSearchRelays()]) {
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
 * SIP-01 index network gets them at the door), then NIP-11-verified
 * SIP-01-capable discovered relays, then the write relays (so they
 * replicate across the network). Deduped.
 */
export function getIndexPublishRelays(): string[] {
  const seen = new Set<string>();
  const pool: string[] = [];
  for (const url of [...getSearchRelayUrls(), ...getDiscoveredIndexRelays(), ...INDEX_WRITE_RELAYS]) {
    if (!seen.has(url)) {
      seen.add(url);
      pool.push(url);
    }
  }
  return pool;
}

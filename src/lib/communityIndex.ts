/**
 * Community Index — user-submitted search results on Nostr.
 *
 * The index isn't just a machine cache — it's community-curated. Any
 * logged-in Nostr user can submit a link; submissions are signed by the
 * user's own key and readable by every compatible client via the Community
 * provider (`src/lib/providers/community.ts`).
 *
 * Submission schema (kind 30078, NIP-78 application data):
 *
 *     ["d", "uncaged:submit:<url-hash>"]   ← unique per URL, per author
 *     ["t", "uncaged-submit"]              ← marker tag (relay-filterable)
 *     ["t", "<content type>"]              ← web | torrent | ipfs | video | ...
 *     ["t", "<user tag>"] ...              ← up to 8 free-form topics
 *     ["title", "<title>"]
 *     ["url", "<url>"]
 *     ["type", "<content type>"]
 *     ["alt", "..."]                       ← NIP-31 human description
 *     content: description (free text)
 *
 * The deterministic d-tag means re-submitting the same URL replaces the
 * user's earlier entry instead of duplicating it.
 */
import type { NostrEvent } from '@nostrify/nostrify';

import type { SearchResult } from '@/lib/providers/types';
import { detectContentType, contentTypeLabel, isValidSubmissionUrl, type ContentType } from '@/lib/contentType';

/** Kind used for community submissions (NIP-78 application data). */
export const COMMUNITY_KIND = 30078;

/** t-tag marking community submissions. */
export const COMMUNITY_T_TAG = 'uncaged-submit';

/** d-tag namespace prefix for submissions. */
export const COMMUNITY_D_PREFIX = 'uncaged:submit:';

/* ------------------------------------------------------------------ */
/* Building                                                            */
/* ------------------------------------------------------------------ */

export interface SubmissionInput {
  url: string;
  title: string;
  description: string;
  tags: string[];
  type?: ContentType; // auto-detected when omitted
}

/** Deterministic d-tag so re-submitting the same URL replaces the user's entry. */
export async function submissionDTag(url: string): Promise<string> {
  const normalized = url.trim().toLowerCase();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${COMMUNITY_D_PREFIX}${hex.slice(0, 24)}`;
}

/** Build tags + content for a community submission event (kind 30078). */
export async function buildSubmissionEvent(
  input: SubmissionInput,
): Promise<{ kind: number; content: string; tags: string[][] }> {
  const type = input.type ?? detectContentType(input.url);
  const dTag = await submissionDTag(input.url);

  const userTags = input.tags
    .map((t) => t.toLowerCase().trim().replace(/\s+/g, '-'))
    .filter((t) => t.length > 0 && t.length <= 40)
    .slice(0, 8);

  return {
    kind: COMMUNITY_KIND,
    content: input.description.trim(),
    tags: [
      ['d', dTag],
      ['t', COMMUNITY_T_TAG],
      ['t', type],
      ...userTags.map((t): string[] => ['t', t]),
      ['title', input.title.trim()],
      ['url', input.url.trim()],
      ['type', type],
      ['alt', `Community index submission: ${input.title.trim()}`],
    ],
  };
}

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

function getTag(event: NostrEvent, name: string): string | undefined {
  return event.tags.find(([n]) => n === name)?.[1];
}

function extractDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch {
    if (url.startsWith('magnet:?')) return 'magnet link';
    if (url.startsWith('ipfs://') || url.startsWith('ipns://')) return 'ipfs';
    return '';
  }
}

/** Parse a community submission event into a SearchResult. */
export function parseSubmissionEvent(event: NostrEvent): SearchResult | null {
  if (event.kind !== COMMUNITY_KIND) return null;
  if (!event.tags.some(([n, v]) => n === 't' && v === COMMUNITY_T_TAG)) return null;

  const title = getTag(event, 'title');
  const url = getTag(event, 'url');
  if (!title?.trim() || !url || !isValidSubmissionUrl(url)) return null;

  const typeTag = getTag(event, 'type') as ContentType | undefined;
  const type = typeTag ?? detectContentType(url);

  return {
    id: event.id,
    title: title.trim(),
    url: url.trim(),
    snippet: event.content.trim(),
    source: 'web',
    provider: 'community',
    timestamp: event.created_at,
    domain: extractDomain(url),
    // Type badge only for non-plain-web links ("Link" would be noise).
    kind: type === 'web' || type === 'other' ? undefined : contentTypeLabel(type),
    engine: 'Community',
    tags: event.tags.filter(([n]) => n === 't').map(([, v]) => v)
      .filter((v) => v !== COMMUNITY_T_TAG && v !== type).slice(0, 5),
    score: 96, // Human-curated — just below organic Nostr results (100).
    nostrEvent: event,
  };
}

/**
 * Index publisher — signs and publishes SIP-01 web index observations
 * (kind 39697, see docs/SIP-01.md).
 *
 * Every observation is signed by THIS DEVICE's dedicated indexer identity
 * (src/lib/indexerIdentity.ts) — never the user's personal Nostr key, and
 * the event never contains a search query. The user's identity and the
 * indexer identity are never linked on purpose.
 *
 * Used by:
 *   - useSearchIndexer  (auto-indexing web results from future providers)
 *   - SubmitToIndex     (community submissions also feed the document index)
 */
import { finalizeEvent } from 'nostr-tools/pure';
import type { NostrEvent } from '@nostrify/nostrify';

import { getIndexerIdentity, getIndexerSecretKey } from '@/lib/indexerIdentity';
import { buildIndexEvent, normalizeIndexUrl, type IndexObservationInput } from '@/lib/webIndex';
import { getIndexPublishRelays } from '@/lib/appRelays';
import { getSearchRelay } from '@/lib/searchRelays';

/** Publish a signed observation to all index relays (best-effort). */
async function publishToIndexRelays(signedEvent: NostrEvent): Promise<void> {
  await Promise.allSettled(
    getIndexPublishRelays().map((url) => getSearchRelay(url).event(signedEvent)),
  );
}

/**
 * Build, sign, and publish one web index observation.
 *
 * Returns the normalized URL on success, or null when the input is not
 * indexable (non-http(s) URL, empty title). Relay failures are swallowed —
 * indexing is best-effort and must never break the UX.
 */
export async function publishIndexObservation(
  input: IndexObservationInput,
): Promise<string | null> {
  const normalized = normalizeIndexUrl(input.url);
  if (!normalized) return null;

  const template = await buildIndexEvent({ ...input, url: normalized });
  if (!template) return null;

  const signedEvent = finalizeEvent(
    {
      kind: template.kind,
      created_at: Math.floor(Date.now() / 1000),
      tags: template.tags,
      content: template.content,
      pubkey: getIndexerIdentity().pubkeyHex,
    },
    getIndexerSecretKey(),
  );

  await publishToIndexRelays(signedEvent);
  return normalized;
}

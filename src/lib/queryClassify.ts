/**
 * Query classification — what KIND of thing did the user type?
 *
 * Used by the AI answer layer: AI runs only for free-text queries.
 * Identifiers (npub/note/…), NIP-05 addresses, and URLs keep their
 * deterministic paths and are never sent to an AI provider.
 */
import { nip19 } from 'nostr-tools';

export type QueryClass = 'nip19' | 'nip05' | 'url' | 'text';

const NIP19_RE = /^(npub1|nprofile1|note1|nevent1|naddr1)[02-9ac-hj-np-z]+$/i;
/** name@domain.tld (NIP-05). */
const NIP05_RE = /^[\w.+-]+@[\w-]+(\.[\w-]+)+$/;
/** Full URL with scheme, or a domain with a path (example.com/page). */
const URL_RE = /^(https?:\/\/\S+|\b[\w-]+(\.[\w-]+)+\/[^\s]*)$/i;

/** Classify a raw query string. */
export function classifyQuery(query: string): QueryClass {
  const q = query.trim();
  if (!q) return 'text';

  // NIP-19 bech32 entity (verify it actually decodes).
  if (NIP19_RE.test(q)) {
    try {
      nip19.decode(q);
      return 'nip19';
    } catch {
      // bech32-looking but invalid — fall through to text.
    }
  }

  // NIP-05 address.
  if (NIP05_RE.test(q)) return 'nip05';

  // URL (scheme + domain, or domain + path). Bare domains stay 'text' —
  // searching "wikipedia.org" should still run the full fan-out.
  if (URL_RE.test(q)) return 'url';

  return 'text';
}

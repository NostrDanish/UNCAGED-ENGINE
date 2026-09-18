/**
 * Sanitize a URL to only allow safe protocols.
 * Returns empty string for dangerous URLs.
 */
export function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.href;
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * Sanitize a SEARCH RESULT's target URL before it becomes a link.
 *
 * Result data is hostile by nature — it comes from external engines, public
 * relays, and community submissions. The clickable set is deliberate:
 *
 *   https: / http:  — normal web links (incl. .onion/.i2p over http)
 *   magnet:         — torrent results (must carry an xt hash)
 *
 * Everything else (javascript:, data:, file:, blob:, chrome:, intent:,
 * ipfs:/ipns: without a gateway, …) is NOT linkable: the caller should
 * render the card without a link wrapper. Returns '' for unsafe URLs.
 * Internal app routes ("/npub1…") are the caller's responsibility.
 */
export function sanitizeResultUrl(url: string): string {
  const u = url.trim();
  if (u.startsWith('magnet:?')) {
    return u.length > 20 ? u : '';
  }
  return sanitizeUrl(u);
}

/**
 * Stricter variant for links that take the user OFF the app: https only,
 * and never loopback/private hosts.
 */
export function sanitizePublicUrl(url: string): string {
  const safe = sanitizeUrl(url);
  if (!safe) return '';
  try {
    const parsed = new URL(safe);
    if (parsed.protocol !== 'https:') return '';

    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (
      host === 'localhost'
      || host.endsWith('.localhost')
      || host.endsWith('.local')
      || host === '::1'
      || host === '0.0.0.0'
      || /^127\./.test(host)
      || /^10\./.test(host)
      || /^192\.168\./.test(host)
      || /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host)
      || /^169\.254\./.test(host)
    ) {
      return '';
    }
    return safe;
  } catch {
    return '';
  }
}

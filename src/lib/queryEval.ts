/**
 * Query evaluation — run a parsed structured query (queryParser.ts)
 * against a flat document record, client-side.
 *
 * This is the local enforcement layer: NIP-50 relays get the raw query as
 * an acceleration hint, but the providers evaluate the AST themselves, so
 * operators behave identically whether or not a relay understands them.
 *
 * Filter fields map onto SIP-01 observation fields (spec §6/§9.2):
 *   site:/domain: → the u tag's host      lang: → the l tag
 *   tag:          → the t topics          type: → type / mime extensions
 *   title:        → content.title         before:/after: → published ?? observedAt
 */
import type { ParsedQuery, QueryNode } from '@/lib/queryParser';

/** A flat document the evaluator can test (adapter per provider). */
export interface QueryDoc {
  title: string;
  description: string;
  url: string;
  topics: string[];
  language?: string;
  /** SIP-01 §9.2 `type` extension (page, video, repository, …). */
  type?: string;
  /** SIP-01 §9.2 `mime` extension (application/pdf, …). */
  mime?: string;
  /** Page-claimed publication time (unix seconds). */
  published?: number;
  /** Observation/event time (unix seconds) — the date fallback. */
  observedAt?: number;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Parse a YYYY[-MM[-DD]] boundary to unix seconds. Null when malformed. */
function dateBoundary(value: string): number | null {
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = m[2] ? Number(m[2]) : 1;
  const day = m[3] ? Number(m[3]) : 1;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return Math.floor(Date.UTC(year, month - 1, day) / 1000);
}

function textHaystack(doc: QueryDoc): string {
  return [doc.title, doc.description, doc.url, ...doc.topics].join(' ').toLowerCase();
}

function evalFilter(node: Extract<QueryNode, { type: 'filter' }>, doc: QueryDoc): boolean {
  const value = node.value.toLowerCase();

  switch (node.field) {
    case 'site': {
      const host = hostOf(doc.url);
      const wanted = value.replace(/^www\./, '');
      return host === wanted || host.endsWith(`.${wanted}`);
    }
    case 'domain':
      return hostOf(doc.url) === value.replace(/^www\./, '');
    case 'title':
      return doc.title.toLowerCase().includes(value);
    case 'lang':
      return doc.language?.toLowerCase() === value;
    case 'tag':
      return doc.topics.some((t) => t.toLowerCase() === value);
    case 'type': {
      // Match the type extension directly, or the mime tail
      // (type:pdf matches mime application/pdf).
      if (doc.type?.toLowerCase() === value) return true;
      const mimeTail = doc.mime?.split('/')[1]?.split(';')[0]?.toLowerCase();
      return mimeTail === value;
    }
    case 'before': {
      const boundary = dateBoundary(node.value);
      if (boundary === null) return false;
      const ts = doc.published ?? doc.observedAt;
      return ts !== undefined && ts < boundary;
    }
    case 'after': {
      const boundary = dateBoundary(node.value);
      if (boundary === null) return false;
      const ts = doc.published ?? doc.observedAt;
      return ts !== undefined && ts >= boundary;
    }
  }
}

function evalNode(node: QueryNode, doc: QueryDoc): boolean {
  switch (node.type) {
    case 'term':
      return textHaystack(doc).includes(node.value.toLowerCase());
    case 'phrase':
      return textHaystack(doc).includes(node.value.toLowerCase());
    case 'and':
      return node.children.every((c) => evalNode(c, doc));
    case 'or':
      return node.children.some((c) => evalNode(c, doc));
    case 'not':
      return !evalNode(node.child, doc);
    case 'filter':
      return evalFilter(node, doc);
  }
}

/**
 * Does the document satisfy the parsed query? An empty/decayed AST matches
 * everything (providers already guard the empty-query case upstream).
 */
export function matchesDoc(parsed: ParsedQuery, doc: QueryDoc): boolean {
  if (!parsed.expr) return true;
  return evalNode(parsed.expr, doc);
}

/**
 * Query evaluator tests — the client-side enforcement layer that runs the
 * parsed AST against SIP-01-shaped documents. Filters hit structured
 * fields (host, language, type, tags, dates); text hits title/desc/url/topics.
 */
import { describe, it, expect } from 'vitest';

import { parseQuery } from '@/lib/queryParser';
import { matchesDoc, type QueryDoc } from '@/lib/queryEval';

const DOC: QueryDoc = {
  title: 'Nostr Protocol Guide',
  description: 'A decentralized search and relay guide for builders.',
  url: 'https://github.com/nostr-protocol/nips',
  topics: ['nostr', 'protocol'],
  language: 'en',
  type: 'repository',
  published: 1_700_000_000, // 2023-11-14
  observedAt: 1_780_000_000,
};

describe('matchesDoc — text', () => {
  it('AND-matches terms across fields by default', () => {
    expect(matchesDoc(parseQuery('nostr guide'), DOC)).toBe(true);
    expect(matchesDoc(parseQuery('nostr missingword'), DOC)).toBe(false);
  });

  it('OR branches match either side', () => {
    expect(matchesDoc(parseQuery('missingword OR nostr'), DOC)).toBe(true);
    expect(matchesDoc(parseQuery('missing OR also-missing'), DOC)).toBe(false);
  });

  it('NOT excludes matches', () => {
    expect(matchesDoc(parseQuery('nostr NOT guide'), DOC)).toBe(false);
    expect(matchesDoc(parseQuery('nostr NOT twitter'), DOC)).toBe(true);
    expect(matchesDoc(parseQuery('nostr -twitter'), DOC)).toBe(true);
  });

  it('phrases are order-sensitive', () => {
    expect(matchesDoc(parseQuery('"protocol guide"'), DOC)).toBe(true);
    expect(matchesDoc(parseQuery('"guide protocol"'), DOC)).toBe(false);
  });

  it('empty query matches everything', () => {
    expect(matchesDoc(parseQuery(''), DOC)).toBe(true);
  });
});

describe('matchesDoc — filters', () => {
  it('site: matches host and subdomains', () => {
    expect(matchesDoc(parseQuery('site:github.com'), DOC)).toBe(true);
    expect(matchesDoc(parseQuery('site:nostr-protocol.github.com'), DOC)).toBe(false);
    expect(matchesDoc(parseQuery('site:example.com'), DOC)).toBe(false);
    // not a suffix-scam match:
    expect(matchesDoc(parseQuery('site:evil-github.com'), DOC)).toBe(false);
  });

  it('domain: requires the exact host', () => {
    expect(matchesDoc(parseQuery('domain:github.com'), DOC)).toBe(true);
    expect(matchesDoc(parseQuery('domain:www.github.com'), DOC)).toBe(false);
  });

  it('title: constrains to the title field', () => {
    expect(matchesDoc(parseQuery('title:guide'), DOC)).toBe(true);
    expect(matchesDoc(parseQuery('title:builders'), DOC)).toBe(false);
  });

  it('lang: matches the document language', () => {
    expect(matchesDoc(parseQuery('lang:en'), DOC)).toBe(true);
    expect(matchesDoc(parseQuery('lang:de'), DOC)).toBe(false);
  });

  it('tag: is an exact topic match', () => {
    expect(matchesDoc(parseQuery('tag:nostr'), DOC)).toBe(true);
    expect(matchesDoc(parseQuery('tag:proto'), DOC)).toBe(false);
  });

  it('type: matches the SIP-01 type extension', () => {
    expect(matchesDoc(parseQuery('type:repository'), DOC)).toBe(true);
    expect(matchesDoc(parseQuery('type:video'), DOC)).toBe(false);
  });

  it('type: falls back to the mime tail', () => {
    const pdf = { ...DOC, type: undefined, mime: 'application/pdf' };
    expect(matchesDoc(parseQuery('type:pdf'), pdf)).toBe(true);
  });

  it('before:/after: use published (fallback observedAt)', () => {
    expect(matchesDoc(parseQuery('after:2023-01-01'), DOC)).toBe(true);
    expect(matchesDoc(parseQuery('before:2023-01-01'), DOC)).toBe(false);
    expect(matchesDoc(parseQuery('before:2024'), DOC)).toBe(true);
    expect(matchesDoc(parseQuery('after:2024-01-01'), DOC)).toBe(false);
  });

  it('malformed dates never match', () => {
    expect(matchesDoc(parseQuery('after:soon'), DOC)).toBe(false);
  });

  it('filters compose with text and booleans', () => {
    expect(matchesDoc(parseQuery('nostr site:github.com'), DOC)).toBe(true);
    expect(matchesDoc(parseQuery('missing site:github.com'), DOC)).toBe(false);
    expect(matchesDoc(parseQuery('(nostr OR bitcoin) AND site:github.com'), DOC)).toBe(true);
    expect(matchesDoc(parseQuery('nostr NOT site:github.com'), DOC)).toBe(false);
  });
});

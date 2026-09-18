/**
 * Referral system tests — ref param parsing, first-touch attribution
 * windows, event shapes, and namespace isolation (this app's t-tag only).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { nip19 } from 'nostr-tools';
import { verifyEvent } from 'nostr-tools/pure';

import {
  AFFILIATE_CLICK_KIND,
  REFERRAL_PING_KIND,
  REFERRAL_T_TAG,
  buildAffiliateClick,
  buildReferralPing,
  parseRefParam,
  getStoredReferrer,
  storeReferrer,
  parseReferralConfig,
  DEFAULT_REFERRAL_CONFIG,
} from './referrals';

const PARTNER_HEX = 'c45041618951bb6012ac23f5cdf3d740465f2d640be841fd9bb1d0733370cd3c';
const OTHER_HEX = '1'.repeat(64);

beforeEach(() => {
  localStorage.clear();
});

describe('parseRefParam', () => {
  it('accepts npub, nprofile, and hex', () => {
    expect(parseRefParam(nip19.npubEncode(PARTNER_HEX))).toBe(PARTNER_HEX);
    expect(parseRefParam(PARTNER_HEX)).toBe(PARTNER_HEX);
    expect(parseRefParam(PARTNER_HEX.toUpperCase())).toBe(PARTNER_HEX);
    expect(parseRefParam(nip19.nprofileEncode({ pubkey: PARTNER_HEX }))).toBe(PARTNER_HEX);
  });

  it('rejects junk and wrong bech32 types', () => {
    expect(parseRefParam('not a ref')).toBeNull();
    expect(parseRefParam('')).toBeNull();
    expect(parseRefParam(nip19.noteEncode('0'.repeat(64)))).toBeNull(); // note ≠ identity
  });
});

describe('first-touch attribution', () => {
  it('stores the first referrer and never overwrites inside the window', () => {
    expect(storeReferrer(PARTNER_HEX, 90)).toBe(true);
    expect(getStoredReferrer()?.pubkey).toBe(PARTNER_HEX);
    // A second partner's link inside the window does NOT re-attribute.
    expect(storeReferrer(OTHER_HEX, 90)).toBe(false);
    expect(getStoredReferrer()?.pubkey).toBe(PARTNER_HEX);
  });

  it('same partner twice = no re-attribution (no duplicate ping)', () => {
    expect(storeReferrer(PARTNER_HEX, 90)).toBe(true);
    expect(storeReferrer(PARTNER_HEX, 90)).toBe(false);
  });

  it('re-attributes after the window expires', () => {
    expect(storeReferrer(PARTNER_HEX, 90)).toBe(true);
    // Age the attribution beyond the window.
    const stored = getStoredReferrer()!;
    localStorage.setItem('uncaged:referrer', JSON.stringify({ ...stored, at: stored.at - 91 * 86_400 }));
    expect(storeReferrer(OTHER_HEX, 90)).toBe(true);
    expect(getStoredReferrer()?.pubkey).toBe(OTHER_HEX);
  });
});

describe('event builders', () => {
  it('ping: addressable per partner, signed, this app’s namespace', () => {
    const ping = buildReferralPing(PARTNER_HEX);
    expect(ping.kind).toBe(REFERRAL_PING_KIND);
    expect(ping.tags).toContainEqual(['d', PARTNER_HEX]);
    expect(ping.tags).toContainEqual(['p', PARTNER_HEX]);
    expect(ping.tags).toContainEqual(['t', REFERRAL_T_TAG]);
    expect(REFERRAL_T_TAG).toBe('uncaged-referral'); // namespace isolation
    expect(verifyEvent(ping)).toBe(true);
  });

  it('click: carries partner + merchant host, this app’s namespace', () => {
    const click = buildAffiliateClick(PARTNER_HEX, 'amazon.ca');
    expect(click.kind).toBe(AFFILIATE_CLICK_KIND);
    expect(click.tags).toContainEqual(['p', PARTNER_HEX]);
    expect(click.tags).toContainEqual(['host', 'amazon.ca']);
    expect(click.tags).toContainEqual(['t', REFERRAL_T_TAG]);
    expect(verifyEvent(click)).toBe(true);
  });
});

describe('parseReferralConfig', () => {
  it('parses a valid config event', () => {
    const event = {
      kind: 30078,
      content: JSON.stringify({ version: 1, enabled: false, attributionWindowDays: 30 }),
      tags: [],
    } as Parameters<typeof parseReferralConfig>[0];
    expect(parseReferralConfig(event)).toEqual({ enabled: false, attributionWindowDays: 30 });
  });

  it('falls back to defaults on junk', () => {
    const bad = { kind: 30078, content: 'not json', tags: [] } as Parameters<typeof parseReferralConfig>[0];
    expect(parseReferralConfig(bad)).toEqual(DEFAULT_REFERRAL_CONFIG);
    const wrongKind = { kind: 1, content: '{}', tags: [] } as Parameters<typeof parseReferralConfig>[0];
    expect(parseReferralConfig(wrongKind)).toEqual(DEFAULT_REFERRAL_CONFIG);
  });
});

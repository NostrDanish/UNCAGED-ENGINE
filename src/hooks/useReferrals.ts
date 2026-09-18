/**
 * Referral hooks + click tracking.
 *
 *  - useReferralConfig()/useReferralConfigActions(): the
 *    uncaged:referral-config event (kind 30078) — public read, owner/admin
 *    write. Config gates the capture; referral STATE stays per-device
 *    (see ReferralCapture.tsx).
 *  - trackAffiliateClick(rawUrl, taggedUrl): call from result/citation
 *    click handlers; publishes one kind 6079 event when the URL actually
 *    got an affiliate tag AND this device arrived via an invite link.
 *  - useMyReferralStats(): the partner dashboard query — pings + clicks
 *    filtered by `#p: [my pubkey]` + this app's t-tag (namespace
 *    isolation) from the moderation relay pool.
 *
 * All events are signed by the per-device analytics key (see
 * src/lib/referrals.ts), publish fire-and-forget, and never block a click.
 */
import { useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { nip19 } from 'nostr-tools';
import type { NostrEvent } from '@nostrify/nostrify';

import { publishToRelayPool, queryRelayPool } from '@/lib/searchRelays';
import {
  OWNER_PUBKEY,
  fetchTeamRoles,
  getModerationRelayUrls,
} from '@/lib/moderation';
import { APP_PROFILE, APP_PROTOCOL, PERMISSIONS } from '@/lib/appProfile';
import {
  REFERRAL_PING_KIND,
  AFFILIATE_CLICK_KIND,
  REFERRAL_T_TAG,
  getStoredReferrer,
  buildAffiliateClick,
  parseReferralConfig,
  buildReferralConfigEvent,
  DEFAULT_REFERRAL_CONFIG,
  type ReferralConfig,
} from '@/lib/referrals';
import { useAdminAccess } from '@/hooks/useAdminAccess';
import { useCurrentUser } from '@/hooks/useCurrentUser';

/* ------------------------------------------------------------------ */
/* Referral configuration (app-owned, owner/admin-managed)             */
/* ------------------------------------------------------------------ */

/**
 * The uncaged:referral-config event — public read, trusted only from
 * owner + admins. Defaults apply when no config event exists yet.
 *
 * Pass `enabled: false` to skip the relay round-trip entirely (the app
 * only needs this config when a `?ref=` param exists or the admin tab
 * renders).
 */
export function useReferralConfig(opts: { enabled?: boolean } = {}): { config: ReferralConfig; isLoading: boolean } {
  const enabled = opts.enabled ?? true;
  const { data, isLoading } = useQuery<ReferralConfig>({
    queryKey: ['referral-config'],
    enabled,
    queryFn: async ({ signal }) => {
      const [roles, settled] = await Promise.all([
        fetchTeamRoles(signal),
        queryRelayPool(
          getModerationRelayUrls(),
          [{ kinds: [30078], '#d': [APP_PROTOCOL.referralConfig], limit: 10 }],
          { signal, timeoutMs: 5000 },
        ),
      ]);

      const trusted = new Set([OWNER_PUBKEY, ...roles.admins]);

      let best: NostrEvent | null = null;
      for (const value of settled) {
        for (const event of value) {
          if (!trusted.has(event.pubkey)) continue;
          if (!best || event.created_at > best.created_at) best = event;
        }
      }

      if (!best) return DEFAULT_REFERRAL_CONFIG;
      return parseReferralConfig(best);
    },
    staleTime: 5 * 60_000,
    retry: 0,
  });

  return { config: data ?? DEFAULT_REFERRAL_CONFIG, isLoading: enabled && isLoading };
}

/** Owner/admin referral-config management. */
export function useReferralConfigActions() {
  const { user } = useCurrentUser();
  const { role } = useAdminAccess();
  const queryClient = useQueryClient();

  const canManage = !!user && PERMISSIONS.canManageReferralConfig(role);

  const updateConfig = useCallback(async (config: ReferralConfig) => {
    if (!user || !canManage) throw new Error('Only the owner or an admin can manage referral settings');

    const template = buildReferralConfigEvent(config, APP_PROTOCOL.referralConfig);

    let event;
    try {
      event = await user.signer.signEvent({
        kind: template.kind,
        content: template.content,
        tags: template.tags,
        created_at: Math.floor(Date.now() / 1000),
      });
    } catch {
      throw new Error('Signing failed — your signer did not respond. Check its connection and try again.');
    }

    let accepted = await publishToRelayPool(getModerationRelayUrls(), event, 12_000);
    if (accepted === 0) {
      await new Promise((r) => setTimeout(r, 2000));
      accepted = await publishToRelayPool(getModerationRelayUrls(), event, 12_000);
    }
    if (accepted === 0) throw new Error('No relay accepted the event — check your connection and try again.');

    setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: ['referral-config'] });
    }, 2000);
  }, [user, canManage, queryClient]);

  return { canManage, updateConfig };
}

/* ------------------------------------------------------------------ */
/* Click tracking (result cards, AI citations)                         */
/* ------------------------------------------------------------------ */

/**
 * Credit an affiliate click to this device's stored referrer. No-op when
 * the URL wasn't actually tagged or there's no referrer. Never throws.
 */
export function trackAffiliateClick(rawUrl: string, taggedUrl: string): void {
  try {
    if (taggedUrl === rawUrl) return; // no rule matched → nothing to count
    const referrer = getStoredReferrer();
    if (!referrer) return;
    const host = new URL(taggedUrl).hostname.replace(/^www\./, '');
    void publishToRelayPool(
      getModerationRelayUrls(),
      buildAffiliateClick(referrer.pubkey, host),
      5000,
    ).catch(() => {});
  } catch {
    // Tracking must never break a click.
  }
}

/* ------------------------------------------------------------------ */
/* Partner dashboard                                                   */
/* ------------------------------------------------------------------ */

export interface ReferralStats {
  /** Distinct referred devices (addressable pings dedupe per device). */
  referrals: number;
  /** Total affiliate clicks from referred devices. */
  clicks: number;
  /** Clicks grouped by merchant host (e.g. amazon.ca → 12). */
  clicksByHost: { host: string; count: number }[];
  /** The raw recent activity, newest first (for the activity list). */
  recent: { kind: 'referral' | 'click'; at: number; host?: string }[];
  /** The partner's tracking link. */
  trackingLink: string;
}

export function useMyReferralStats(): { stats: ReferralStats | null; isLoading: boolean } {
  const { user } = useCurrentUser();
  const pubkey = user?.pubkey;

  const { data, isLoading } = useQuery({
    queryKey: ['referral-stats', pubkey ?? ''],
    enabled: !!pubkey,
    queryFn: async ({ signal }) => {
      const settled = await queryRelayPool(
        getModerationRelayUrls(),
        [{
          kinds: [REFERRAL_PING_KIND, AFFILIATE_CLICK_KIND],
          '#p': [pubkey!],
          '#t': [REFERRAL_T_TAG], // namespace isolation: this app's records only
          limit: 500,
        }],
        { signal, timeoutMs: 6000 },
      );

      const pings = new Set<string>();
      let clicks = 0;
      const byHost = new Map<string, number>();
      const recent: ReferralStats['recent'] = [];

      for (const value of settled) {
        for (const event of value) {
          if (!isValidRefEvent(event, pubkey!)) continue;
          if (event.kind === REFERRAL_PING_KIND) {
            pings.add(event.pubkey); // addressable: one per device anyway; belt + suspenders
            recent.push({ kind: 'referral', at: event.created_at });
          } else {
            clicks++;
            const host = event.tags.find(([n]) => n === 'host')?.[1] ?? 'unknown';
            byHost.set(host, (byHost.get(host) ?? 0) + 1);
            recent.push({ kind: 'click', at: event.created_at, host });
          }
        }
      }

      recent.sort((a, b) => b.at - a.at);

      return {
        referrals: pings.size,
        clicks,
        clicksByHost: [...byHost.entries()]
          .map(([host, count]) => ({ host, count }))
          .sort((a, b) => b.count - a.count),
        recent: recent.slice(0, 20),
        trackingLink: `${APP_PROFILE.siteUrl}/?ref=${nip19.npubEncode(pubkey!)}`,
      } satisfies ReferralStats;
    },
    staleTime: 60_000,
    retry: 0,
  });

  return { stats: data ?? null, isLoading: !!pubkey && isLoading };
}

/** Only count well-formed events actually aimed at this partner, in THIS
 *  app's namespace (kinds are shared across engines — the t-tag is the
 *  boundary). */
function isValidRefEvent(event: NostrEvent, partner: string): boolean {
  if (event.kind !== REFERRAL_PING_KIND && event.kind !== AFFILIATE_CLICK_KIND) return false;
  if (!event.tags.some(([n, v]) => n === 't' && v === REFERRAL_T_TAG)) return false;
  if (!event.tags.some(([n, v]) => n === 'p' && v === partner)) return false;
  if (event.kind === REFERRAL_PING_KIND) {
    // Addressable ping: d must equal the partner (prevents junk in the p-tag space).
    return event.tags.find(([n]) => n === 'd')?.[1] === partner;
  }
  return true;
}

/** Convenience for components: the current user's tracking link. */
export function useTrackingLink(): string | null {
  const { user } = useCurrentUser();
  return useMemo(
    () => (user ? `${APP_PROFILE.siteUrl}/?ref=${nip19.npubEncode(user.pubkey)}` : null),
    [user],
  );
}

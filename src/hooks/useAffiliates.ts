/**
 * Affiliate rules — read (everyone) + write (owner + admins).
 *
 * Read: the kind 30078 config event (d-tag `uncaged:affiliate-rules`) from
 * the moderation relay pool, accepted from the owner OR any owner-listed
 * admin. The admin role list is itself owner-signed, so the trust chain is
 * still rooted at the owner key. Public by design — affiliate codes are
 * visible in tagged URLs anyway — so this runs for anonymous visitors too.
 *
 * Write: any team admin publishes a replacement config event (addressable
 * → latest wins across the team) onto the moderation relays, same
 * transport as role lists.
 */
import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { NostrEvent } from '@nostrify/nostrify';

import { publishToRelayPool, queryRelayPool } from '@/lib/searchRelays';
import {
  AFFILIATES_KIND,
  AFFILIATES_D_TAG,
  parseAffiliateRules,
  buildAffiliateRulesEvent,
  type AffiliateRule,
} from '@/lib/affiliates';
import {
  OWNER_PUBKEY,
  fetchTeamRoles,
  getModerationRelayUrls,
} from '@/lib/moderation';
import { PERMISSIONS } from '@/lib/appProfile';
import { useAdminAccess } from '@/hooks/useAdminAccess';
import { useCurrentUser } from '@/hooks/useCurrentUser';

export function useAffiliateRules(): { rules: AffiliateRule[]; isLoading: boolean } {
  const { data, isLoading } = useQuery<AffiliateRule[]>({
    queryKey: ['affiliate-rules'],
    queryFn: async ({ signal }) => {
      // One round-trip: the owner-signed role lists + every candidate
      // affiliate config. Author trust resolves via the owner-rooted role
      // model.
      const [roles, configSettled] = await Promise.all([
        fetchTeamRoles(signal),
        queryRelayPool(
          getModerationRelayUrls(),
          [{ kinds: [AFFILIATES_KIND], '#d': [AFFILIATES_D_TAG], limit: 10 }],
          { signal, timeoutMs: 5000 },
        ),
      ]);

      // Trusted authors: owner + current admins. An admin who was removed
      // stops being trusted immediately (the role list is the latest word).
      const trusted = new Set([OWNER_PUBKEY, ...roles.admins]);

      // Last-write-wins among trusted team members.
      let best: NostrEvent | null = null;
      for (const value of configSettled) {
        for (const event of value) {
          if (!trusted.has(event.pubkey)) continue;
          if (!best || event.created_at > best.created_at) best = event;
        }
      }

      return best ? parseAffiliateRules(best, trusted) : [];
    },
    staleTime: 5 * 60_000,
    retry: 0,
  });

  return { rules: data ?? [], isLoading };
}

/** Team rule management (owner + admins; whole-list replace, addressable). */
export function useAffiliateActions() {
  const { user } = useCurrentUser();
  const { role } = useAdminAccess();
  const queryClient = useQueryClient();

  // Central permission matrix — owner + admins, nothing else.
  const canManage = !!user && PERMISSIONS.canManageAffiliates(role);

  const updateRules = useCallback(async (rules: AffiliateRule[]) => {
    if (!user || !canManage) throw new Error('Only the owner or an admin can manage affiliate rules');

    const template = buildAffiliateRulesEvent(rules);

    // Signing is a separate failure mode (a remote signer can time out on
    // mobile/VPN) — give it its own message instead of a raw AbortError.
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

    // Relay publish on mobile/VPN can be slow: longer timeout + one retry.
    let accepted = await publishToRelayPool(getModerationRelayUrls(), event, 12_000);
    if (accepted === 0) {
      await new Promise((r) => setTimeout(r, 2000));
      accepted = await publishToRelayPool(getModerationRelayUrls(), event, 12_000);
    }
    if (accepted === 0) {
      throw new Error('No relay accepted the event — check your connection (VPN?) and try again.');
    }

    setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: ['affiliate-rules'] });
    }, 2000);
  }, [user, canManage, queryClient]);

  return { canManage, updateRules };
}

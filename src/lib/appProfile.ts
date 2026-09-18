/**
 * UNCAGED application profile — the single source of truth for THIS
 * engine's identity, namespaces, and feature flags.
 *
 * Architecture rule (SIP-01 ecosystem): the protocol/index layer
 * (kind 39697, widx:*, NIP-50/77…) is SHARED across engines and never
 * renamed. Everything APPLICATION-SPECIFIC — moderation, roles, reports,
 * referral/affiliate control data, AI personality, localStorage keys —
 * lives under this app's own namespace (`uncaged`), never another
 * engine's.
 *
 * Forks: this is the file you rebrand. Do not scatter brand strings or
 * namespaces through the app — change them here.
 */

/** The AI answer layer's engine personality (used by user-BYOK calls; an
 *  engine-tier worker should inject the same prompt server-side). */
export const UNCAGED_SYSTEM_PROMPT = `You are the Uncaged answer engine — a synthesis layer over a decentralized, Nostr-native search network.

Rules:
- Answer using ONLY the supplied evidence whenever possible.
- NEVER invent sources or URLs.
- Cite every factual statement with [n] markers referencing the evidence items.
- Clearly separate what the evidence says from your own inference.
- If the evidence is insufficient, say so plainly and say what is missing.
- Be concise: a direct answer first, then supporting detail. No preamble.`;

/**
 * UNCAGED control-plane namespaces — the ONLY namespaces this app writes
 * application data to. SIP-01 identifiers (widx:, the 39697 kind, the
 * protocol's tag set) are shared protocol ground and intentionally absent
 * here.
 */
export const APP_PROTOCOL = {
  /** kind 30078, d-tag: owner-signed admin pubkey list. */
  adminRoles: 'uncaged:admin-roles',
  /** kind 30078, d-tag: owner-signed moderator pubkey list. */
  moderatorRoles: 'uncaged:mod-roles',
  /** t-tag marker on role-list events. */
  rolesTag: 'uncaged-roles',
  /** NIP-32 label namespace (kind 1985): hidden results. */
  moderation: 'uncaged.moderation',
  /** NIP-32 self-label namespace on kind 1984 abuse reports. */
  abuse: 'uncaged.abuse',
  /** kind 30078, d-tag prefix: community index submissions. */
  communitySubmitPrefix: 'uncaged:submit:',
  /** t-tag marker on community submissions. */
  communitySubmitTag: 'uncaged-submit',
  /** kind 30078, d-tag: owner/admin-signed affiliate rule config. */
  affiliateRules: 'uncaged:affiliate-rules',
  /** t-tag marker on the affiliate rule config. */
  affiliateRulesTag: 'uncaged-affiliate-rules',
  /** kind 30078, d-tag: owner/admin-signed Invite (referral) config. */
  referralConfig: 'uncaged:referral-config',
  /** t-tag marker on referral pings + affiliate clicks (kinds 34967/6079). */
  referralTag: 'uncaged-referral',
} as const;

export const APP_PROFILE = {
  /** Stable machine id. */
  appId: 'uncaged',
  /** App name. */
  appName: 'UNCAGED',
  /** Display name (header, titles). */
  displayName: 'Uncaged Engine',
  namespace: 'uncaged',
  tagline: 'Search Nostr and the shared web index. No backend. No tracking.',
  description:
    'A Nostr-native search engine template — NIP-50 relay search, a shared SIP-01 decentralized web index, and community-curated links. No backend, no tracking.',
  /** Canonical deployment URL (used for referral links). */
  siteUrl: 'https://uncaged.shakespeare.wtf',
  repoUrl: 'https://github.com/NostrDanish/UNCAGED-ENGINE',

  sip: {
    protocol: 'SIP-01',
    /**
     * Indexer software id stamped as the `source` tag on every kind 39697
     * observation this engine publishes (spec §6) — one id per engine so
     * the network attributes contributions to THIS engine.
     */
    indexerSource: 'uncaged-engine/1',
    /** Source id for observations derived from community submissions. */
    submitterSource: 'uncaged-engine-submit/1',
  },

  ai: {
    /** Engine personality for the answer layer (see src/lib/ai/prompts.ts). */
    systemPrompt: UNCAGED_SYSTEM_PROMPT,
  },

  features: {
    /** Team moderation (NIP-32 labels) + abuse reports (NIP-56). */
    moderation: true,
    reports: true,
    /** `?ref=` invite attribution + owner-managed affiliate tagging. */
    referrals: true,
    affiliates: true,
    /** NIP-66/NIP-11 relay auto-discovery. */
    relayDiscovery: true,
    /** AI answer layer (BYOK / engine proxy). */
    ai: true,
  },
} as const;

export type AppProfile = typeof APP_PROFILE;

/* ------------------------------------------------------------------ */
/* Permission matrix (team roles)                                      */
/* ------------------------------------------------------------------ */

export type AppTeamRole = 'owner' | 'admin' | 'moderator' | 'user';

/**
 *   Action                        owner  admin  moderator  user
 *   search / read SIP-01          yes    yes    yes        yes
 *   view + process abuse reports  yes    yes    yes        no
 *   moderate (hide/unhide)        yes    yes    yes        no
 *   manage affiliate rules        yes    yes    no         no
 *   manage referral config        yes    yes    no         no
 *   manage roles                  yes    no     no         no
 *   manage engine AI config       yes    no     no         no
 *
 * The trust root itself (OWNER_PUBKEY) is a code constant — ownership
 * changes by deploy, never by protocol action.
 */
export const PERMISSIONS = {
  canViewReports: (role: AppTeamRole): boolean => role !== 'user',
  canModerate: (role: AppTeamRole): boolean => role !== 'user',
  canManageAffiliates: (role: AppTeamRole): boolean => role === 'owner' || role === 'admin',
  canManageReferralConfig: (role: AppTeamRole): boolean => role === 'owner' || role === 'admin',
  canManageRoles: (role: AppTeamRole): boolean => role === 'owner',
  canManageEngineConfig: (role: AppTeamRole): boolean => role === 'owner',
} as const;

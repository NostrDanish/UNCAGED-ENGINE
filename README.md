# Uncaged Engine

**A minimal Nostr-native search engine template.** The pure core of
[0xSearchstr](https://github.com/NostrDanish/0xSearchstr) — the search
orchestrator, the Nostr providers, the shared web index protocol, and a clean
light/dark UI — with every extra removed so you can build your own search
engine on top.

No backend. No crawler. No tracking. Everything runs in the browser and talks
to Nostr relays over WebSocket.

[![Edit with Shakespeare](https://shakespeare.diy/badge.svg)](https://shakespeare.diy/clone?url=https%3A%2F%2Fgithub.com%2FNostrDanish%2FUNCAGED-ENGINE.git)

---

## What you get

- **Provider architecture** — every source implements one `SearchProvider`
  interface; an orchestrator runs them in parallel and merges, dedupes, and
  ranks the results. Add your own provider in ~50 lines.
- **Nostr search (NIP-50)** — full-text search across NIP-50-capable relays:
  profiles (kind 0), notes (kind 1), files (kind 1063), articles (kind 30023),
  wiki pages (kind 30818).
- **Shared web index (SIP-01, kind 39697)** — a decentralized document index
  on Nostr. Reads observations from every indexer (NIP-50-accelerated on
  SIP-01-aware relays, with hash verification per spec §18); auto-indexes
  newly discovered pages with a per-device anonymous keypair. Implements the
  canonical spec at [github.com/NostrDanish/SIP-01](https://github.com/NostrDanish/SIP-01).
- **Community index (kind 30078)** — any logged-in Nostr user can submit
  links. Signed, attributable, relay-filterable.
- **AI answers (optional)** — an evidence-cited AI layer over the results:
  BYOK (any OpenAI-compatible API) or an engine-provided tier (operator key
  via a same-origin proxy). Off by default; answers are ephemeral and never
  indexed. No provider key ever ships in the bundle.
- **Reference system** — invite links (`?ref=npub…`) with first-touch
  attribution, owner-managed affiliate URL tagging (param + redirect rules),
  and pseudonymous click attribution — all in this app's `uncaged` namespace.
- **Structured queries** — `AND`/`OR`/`NOT`, `"exact phrases"`, and
  `site:` `domain:` `title:` `type:` `lang:` `tag:` `before:` `after:`
  filters, parsed safely (never throws) and enforced client-side.
- **Relay discovery** — finds extra NIP-50 / SIP-01 relays automatically:
  NIP-66 announcements → NIP-11 verification → verified relays join the
  pool. Toggle in Settings → Search Relays.
- **Moderation & abuse reports** — team-signed NIP-32 labels (kind 1985)
  hide results for every user; NIP-56 reports (kind 1984) from any result
  card land in the admin inbox; un-hiding is a NIP-09 deletion.
- **Team console (`/admin`)** — role-gated dashboard: stats, reports inbox,
  moderation, filter tester, engine-AI management, and owner-managed roles
  (owner-signed kind 30078 role lists).
- **Complete search UI/UX** — hero search page, live per-provider status,
  result cards, source tabs (All / Nostr / Web), skeletons, empty states,
  keyboard shortcuts (`Ctrl+K` / `/`), shareable `?q=` URLs, OpenSearch.
- **NIP-19 routing** — `/npub1…`, `/note1…`, `/nevent1…`, `/naddr1…`,
  `/nprofile1…` render profile/event pages out of the box.
- **Settings page** — light/dark/system theme, auto-index toggle, indexing
  identity management, NIP-65 relay list, NIP-50 search-relay pool with
  latency tester.
- **Nostr login** — signup, browser extensions (NIP-07), nsec, and remote
  signers (NIP-46), ready to go.

## What you don't get (on purpose)

SearXNG / DuckDuckGo / Wikipedia / Hacker News / Stack Overflow / Tor
providers, instant answers, trending queries, the explore page, the autosigner
worker, the self-hosted backend, and extra themes. They all live in
[0xSearchstr](https://github.com/NostrDanish/0xSearchstr) if you want
reference implementations — the provider interface here is the same one.
The moderation + admin console and the AI answer layer are ported from
[0xPresearchstr](https://github.com/NostrDanish/0xPresearchstr); its
keyword-staking, votes, and term signals remain there as reference.

---

## Quick start

```bash
git clone https://github.com/NostrDanish/UNCAGED-ENGINE.git
cd UNCAGED-ENGINE
npm install
npm run dev
```

Open the printed URL and search. That's it — there is no server to configure.

Deploy the `dist` folder (`npm run build`) to any static host.

---

## How it works

```
Search query
     │
     ▼
┌──────────── useProviderSearch (the orchestrator) ───────────┐
│  Runs every registered provider in parallel (Promise.allSettled) │
│                                                              │
│   Web Index          Nostr              Community            │
│   kind 39697         NIP-50 search      kind 30078           │
│   (SIP-01 docs)      (0/1/1063/30023/   (user-curated        │
│                      30818)              links)              │
│                                                              │
│   → SearchResult[]   → SearchResult[]   → SearchResult[]     │
└──────────────────────────┬───────────────────────────────────┘
                           │
                  merge · dedupe by URL · rank by score
                           │
                           ▼
                     Results render
                           │
                           ▼
                  auto-indexer (useSearchIndexer)
              new web pages → kind 39697 events,
        signed by this device's anonymous indexer identity
```

The universal currency is the **`SearchResult`** (`src/lib/providers/types.ts`).
Every provider returns the same shape; the UI renders any of them with one
component (`UnifiedResultCard`).

### Provider list

| Provider | What it searches | Kind(s) | File |
|----------|------------------|---------|------|
| **Web Index** | Shared document observations from all indexers | 39697 | `src/lib/providers/web-index.ts` |
| **Nostr** | Profiles, notes, files, articles, wiki via NIP-50 | 0, 1, 1063, 30023, 30818 | `src/lib/providers/nostr.ts` |
| **Community** | User-submitted links | 30078 | `src/lib/providers/community.ts` |

Ranking is simple and hackable: each result carries a `score` (Nostr content
100–110, community curation 96, web-index observations 93 + agreement bonus),
then recency breaks ties. Tune the numbers in the providers; change the sort
in `src/hooks/useProviderSearch.ts`.

---

## Guides

### 1. Adding a provider

Three steps, no other wiring:

**Step 1 — create `src/lib/providers/my-provider.ts`:**

```typescript
import type { SearchProvider, SearchOptions, ProviderSearchResponse } from './types';

export const myProvider: SearchProvider = {
  id: 'my-provider',
  name: 'My Provider',
  source: 'web', // 'nostr' | 'web' — which tab it belongs to

  async search({ query, signal }: SearchOptions): Promise<ProviderSearchResponse> {
    if (!query.trim()) return { results: [] };

    const data = await fetch(`https://api.example.com/search?q=${encodeURIComponent(query)}`, { signal })
      .then((r) => r.json());

    return {
      results: data.items.map((item: { title: string; url: string; text: string }) => ({
        id: item.url,
        title: item.title,
        url: item.url,
        snippet: item.text,
        source: 'web',
        provider: 'my-provider',
        domain: new URL(item.url).hostname,
        engine: 'Example',
        score: 80, // below Nostr (100) — see ranking notes above
      })),
    };
  },
};
```

**Step 2 — register it** in `src/lib/providers/registry.ts`:

```typescript
import { myProvider } from './my-provider';

export const ALL_PROVIDERS: SearchProvider[] = [
  webIndexProvider,
  nostrProvider,
  communityProvider,
  myProvider, // ← added
];
```

**Step 3 — done.** The orchestrator runs it on every search, the status line
shows its latency, results render in the standard card, and — because the
results are http(s) web pages — the auto-indexer contributes them to the
shared index automatically (unless the user disabled it in Settings).

**Privacy honesty:** every built-in provider is Nostr-only (relay operators
see queries; no account is linked). If your provider calls a clearnet API,
that API operator sees the query too — say so in your UI. Keep it honest.

### 2. How auto-indexing works (SIP-01)

Every search grows the shared index — without ever leaking the query. The
index has two feeders, both going through `publishIndexObservation()`
(`src/lib/indexPublisher.ts`):

**A. Community submissions.** When a user submits an http(s) link, the app
publishes two events: their signed kind 30078 submission (attribution) AND a
kind 39697 observation signed by the device indexer identity (shared document
index). The index grows from the first submission — no external provider
needed.

**B. Search-driven indexing.** After every search, `useSearchIndexer`
contributes the web pages the search surfaced. In a Nostr-native engine,
"discovered web pages" are the ones Nostr content *references*:

- **File metadata (kind 1063)** — the `url` tag is a real web resource with
  an author-provided title/description → rich observation.
- **Links cited in notes/articles** — a web link referenced by content that
  matched your query is a genuine discovery signal → discovery-layer
  observation (host as title, no description — the citing text is commentary,
  never page metadata; crawlers enrich these later).
- **Any external provider you add** (see "Adding a provider") — its http(s)
  results are indexed automatically.

```
search results arrive
       │
       ▼
useSearchIndexer filters:
  ✗ skip results that came FROM the index (web-index/community — no echo loop)
  ✗ skip Nostr content itself (already on relays)
  ✓ keep Nostr results that REFERENCE a web page (webUrl)
  ✓ keep http(s) results from external providers
       │
       ▼
for each remaining URL (max 10 per search):
  normalize URL  →  d = "widx:" + sha256(url)[0:32]
  build kind 39697 event { title, description, image, topics }
  sign with the DEVICE indexer keypair (never the user's key)
  publish to the index relay set
```

Settings → Indexing shows a live count of observations published this
session, so you can watch the index grow as you search.

- **The query is never published.** The event contains a URL and its public
  metadata — nothing about who searched for what.
- **The user's Nostr identity is never used.** Each browser generates its own
  dedicated indexer keypair on first use (`src/lib/indexerIdentity.ts`):
  pseudonymous, replaceable, exportable in Settings → Indexing.
- **Every client is an indexer.** Multiple indexers observing the same URL
  produce events with the same `d` tag — search nodes group by `d` and count
  distinct authors ("N independent indexers saw this page").

**Spec conformance (v1.2):** `src/lib/webIndex.ts` is the reference
implementation — byte-compatible URL normalization (spec §7) and content
hashing (§8), proven by the §13/§19 test vectors in `webIndex.test.ts`. The
registered extension tags (§9.2 — `type`, `platform`, `category`, `network`,
`country`, `mime`) are supported on build and parse; the Web Index provider
uses NIP-50 acceleration with web operators (`site:`, `lang:`, …) on
SIP-01-aware relays (§15) and verifies `d`/`x` hashes before display (§18).
Ecosystem docs, the tag registry, and the live explorer live at
[github.com/NostrDanish/SIP-01](https://github.com/NostrDanish/SIP-01).

The full wire format is specified in
**[docs/SIP-01.md](docs/SIP-01.md)** (mirrored from the canonical
[SIP-01 repo](https://github.com/NostrDanish/SIP-01)) and implemented in
`src/lib/webIndex.ts`, covered by the spec's §13 test vectors in
`webIndex.test.ts`.

### 3. Bootstrapping the index (seed data)

A fresh index is empty — crawlers alone take months to find the web. The
`seed` script converts existing web-metadata corpora (reference source:
[OfflineWebSearch](https://github.com/rumca-js/OfflineWebSearch)'s curated
SQLite datasets) into SIP-01 observations, byte-compatibly:

```bash
curl -LO https://rumca-js.github.io/data/top.db.zip && unzip top.db.zip
npm run seed -- top.db                      # → seed-top.jsonl (dry run)
npm run seed -- top.db --publish --nsec nsec1…   # sign + publish to relays
```

Seeded documents arrive as ordinary kind 39697 events — the Web Index
provider reads them with **no client changes**. Supports deterministic
sharding (`--shard 2/8`) so multiple crawlers can partition a corpus.
Full guide: **[docs/SEEDING.md](docs/SEEDING.md)**.

### 4. The community index (kind 30078)

The Submit button in the header lets any logged-in user add a link. The event
schema (`src/lib/communityIndex.ts`):

```json
{
  "kind": 30078,
  "content": "<description — shown as the search snippet>",
  "tags": [
    ["d", "uncaged:submit:<sha256(url)[0:24]>"],  ← unique per URL per author
    ["t", "uncaged-submit"],                       ← relay-filterable marker
    ["t", "<content type>"],                       ← web | torrent | ipfs | video | audio | pdf | onion
    ["t", "<user tag>"],                           ← up to 8 free-form topics
    ["title", "<title>"],
    ["url", "<url>"],
    ["type", "<content type>"],
    ["alt", "Community index submission: <title>"]
  ]
}
```

The deterministic `d` tag means re-submitting the same URL **replaces** the
user's earlier entry. The Community provider fetches recent `#t:
uncaged-submit` events and matches them client-side (relays can't full-text
search tags). Submissions are signed by the user's own key — curation is
attributable, and spam can be filtered by author later.

http(s) submissions are additionally published as **SIP-01 web index
observations** (kind 39697) signed by the device's anonymous indexer
identity — so every submission grows the shared document index too
(`src/components/SubmitToIndex.tsx` → `publishIndexObservation()`).

`http(s)://`, `magnet:`, `ipfs://`, and `.onion` links are accepted;
`javascript:`/`data:` and friends are rejected at parse and build time
(`isValidSubmissionUrl` in `src/lib/contentType.ts`).

### 5. Moderation & the team console (`/admin`)

Nostr-native moderation, no database:

- **Reports (NIP-56, kind 1984)** — every result card has a flag button.
  Reports are signed by the reporter's key under the `uncaged.abuse`
  namespace and land in Admin → Reports.
- **Moderation labels (NIP-32, kind 1985)** — team members hide a URL or
  event id with one click; the label is published to the moderation relay
  set and **every client filters it out** within a minute. Un-hiding
  publishes a NIP-09 deletion. Clients trust labels from the owner + team
  role lists only — the author filter is the trust boundary.
- **Roles (kind 30078)** — the owner manages admins/moderators as
  owner-signed addressable lists (`uncaged:admin-roles` /
  `uncaged:mod-roles`); every client resolves them live. Team members see
  an "Admin console" entry in their account menu.
- **Filter test** — check whether a URL/event id is currently filtered.
- **Stats** — live index + community + moderation counters.

⚠️ **`OWNER_PUBKEY` in `src/lib/moderation.ts` is the trust root.** It's set
to this project's owner — if you fork, replace it with your own pubkey or
your role lists and labels won't be trusted by your deployment.

### 6. AI answers (optional, off by default)

An AI layer sits AFTER the search federation: the top results become a
numbered evidence pack, and an OpenAI-compatible model synthesizes an answer
with clickable `[n]` citations (`AIAnswerCard` above the results). Answers
are ephemeral — never indexed into SIP-01.

**Credential precedence (exactly):**

```
User's own key (Settings → AI)   ← always wins; stored only in their browser
        ↓
Keyless provider (e.g. Ollama)   ← local models need no key
        ↓
Engine-provided AI (/api/ai)     ← operator's key, server-side only (worker)
        ↓
AI unavailable
```

**Secret rule (hard):** NO provider API key ships in this repository or the
frontend bundle. The user's key stays in their browser's localStorage; the
operator's key stays server-side in the deployment's secret store (worker
env / KV). Provider credentials should ultimately live behind a
signer/proxy service (0xSigner pattern): the browser only ever calls a
same-origin, key-injecting proxy — never a provider directly with a shared
credential.

- **BYOK** — PPQ.ai, OpenRouter, OpenAI, Ollama (local, no key), or any
  custom OpenAI-compatible endpoint. Provider/endpoint/model unlock the
  moment a key is pasted.
- **Engine tier** — a thin same-origin proxy over `src/lib/ai/engineProxy.ts`
  serves users with no key of their own; Admin → AI manages it (status,
  set/clear key, enable toggle, test) with NIP-98-flavored signed events
  (kind 27235) — no accounts or passwords. The proxy requires a server-side
  deployment (a Cloudflare Worker shell is ~100 lines over the tested
  `engineProxy` functions; add one if you deploy to an edge platform).
  On static hosting the tab reports "not configured" and everything else
  keeps working.
- **Privacy boundaries** — AI runs only on plain-text queries (NIP-19/05
  identifiers and URLs are never sent — see `src/lib/queryClassify.ts`);
  Nostr results are excluded from evidence unless the user opts in.

### 7. Theming (light & dark)

Themes are CSS variables in `src/index.css` — `:root` (light) and `.dark`.
The `system` option follows the OS. To rebrand:

1. Change `--primary` (both palettes) — every accent, glow, and badge follows.
2. Fonts: Inter (UI) + JetBrains Mono (URLs/keys), loaded in `src/main.tsx`.
3. The theme picker lives in Settings → Appearance
   (`THEMES` in `src/pages/Settings.tsx`).

### 8. Relays

Two relay layers, both editable in Settings:

- **Your Relays (NIP-65, kind 10002)** — the user's personal relay list for
  login/profile/submissions. Synced from Nostr on login, published back on
  change.
- **Search Relays (NIP-50 + SIP-01)** — the pool every search query fans out
  to, and the first publish target for index observations. Defaults
  (`SEARCH_RELAYS` in `src/lib/appRelays.ts`):
  - *SIP-01 index network:* `relay-na1.metanomalist.com` (the validating
    UNCAGED Index Relay), `relay.ditto.pub`, `jskitty.cat/nostr`,
    a Tor onion relay (`ws://….onion`, reachable for Tor Browser users),
    `search.nos.today`, `relay.primal.net`, `nostr.hifish.org`
  - *NIP-50 full-text:* `relay.nostr.band`, `relay.noswhere.com`

  **Fully user-editable:** users can add custom relays AND remove any
  default (stored locally in `uncaged:search-relays:*`), with a
  one-click "Restore defaults" in Settings. Re-adding a removed default
  restores it as a default rather than duplicating it as a custom.
  Settings also includes a per-relay latency tester — the onion relay
  honestly shows as unreachable outside Tor.

- **Relay discovery (NIP-66 + NIP-11)** — the app optionally finds extra
  relays itself (`src/lib/relayDiscovery.ts`): NIP-66 relay announcements
  (`kind 30166`, `#N: 50`) become candidates; every candidate's NIP-11
  document is then VERIFIED before it joins the pool (NIP-50 search tier
  when `supported_nips` includes 50; SIP-01 index tier when it advertises
  the `uncaged_index` block — spec §15). Verified relays are cached 24h,
  sorted by probe latency, capped, and removable like any other relay.
  Toggle in Settings → Search Relays.

Index observations publish to the search pool plus verified SIP-01
discovered relays plus `INDEX_WRITE_RELAYS` (ditto/primal/damus) for wider
propagation — `getIndexPublishRelays()`.

The conceptual layout (documented in `src/lib/appRelays.ts`):

```
indexRead   — search pool (defaults + customs + discovered NIP-50/SIP-01)
indexWrite  — INDEX_WRITE_RELAYS (propagation)
control     — moderation/roles/reports/referral configs (moderation pool)
fallback    — the user's NIP-65 relay list (APP_RELAYS defaults)
```

Change the defaults in `src/lib/appRelays.ts` (`APP_RELAYS` for the NIP-65
defaults, `SEARCH_RELAYS` for the search pool).

### 9. Structured queries

The search bar understands more than keywords (`src/lib/queryParser.ts` +
`src/lib/queryEval.ts`):

| Syntax | Meaning |
|---|---|
| `nostr privacy` | implicit AND |
| `nostr AND privacy` / `OR` / `NOT` | explicit booleans (UPPERCASE only — "rock and roll" stays text) |
| `-twitter` | NOT shorthand |
| `"decentralized search"` | exact phrase (order-sensitive) |
| `( … )` | grouping, precedence NOT > AND > OR |
| `site:github.com` | host or subdomain of |
| `domain:github.com` | exact host |
| `title:nostr` | term in the document title |
| `type:pdf` / `type:repository` | SIP-01 `type` (or `mime` tail) |
| `lang:en` | ISO 639-1 document language |
| `tag:nostr` | exact topic tag |
| `before:2024` / `after:2026-01-01` | date boundary (published ?? observed) |

The parser never throws — malformed input degrades gracefully. SIP-01-aware
relays ALSO get the raw query as a NIP-50 hint (their server-side operators
may answer better); the client-side evaluator enforces the same semantics on
whatever comes back.

### 10. The reference system (invites + affiliates)

Two cooperating pieces, both in this app's `uncaged` namespace (never shared
with other engines):

- **Invites (`?ref=`)** — `/invite` gives any logged-in user a tracking
  link. First-touch attribution (never overwritten inside the window),
  self-referrals rejected, and a single addressable ping (kind 34967) per
  referred device — signed by a dedicated per-device analytics key, NOT the
  user's account and NOT the SIP-01 indexer identity. Partners see counts,
  not people.
- **Affiliate tagging** — owner/admins publish one signed kind 30078 rule
  list (`uncaged:affiliate-rules`): host → param map (Amazon `tag=`,
  eBay's 5-param EPN set) or host → redirect link (PPQ-style invite URLs,
  with `{url}` substitution). Matching result links are tagged for every
  user; referred-device clicks publish one pseudonymous kind 6079 event.
  Admin → Affiliates has the full rule editor (auto-fill from a pasted
  affiliate URL) + a live tester.

Counts are public-by-design engagement metrics — settlement belongs to the
affiliate networks' own reports.

### 11. Make it yours — checklist

- [ ] Rename "Uncaged Engine" in `src/components/Layout.tsx`,
      `src/pages/Index.tsx`, `index.html`, `public/manifest.webmanifest`
- [ ] Replace `public/favicon.svg`
- [ ] Point `public/opensearch.xml` at your deployed origin
- [ ] **Replace `OWNER_PUBKEY` in `src/lib/moderation.ts` with your own key**
      (the admin console, roles, and moderation labels trust it)
- [ ] Adjust default relays in `src/lib/appRelays.ts`
- [ ] Pick your accent color in `src/index.css`
- [ ] AI: no key ships in the bundle by design — users bring their own
      (Settings → AI) or you deploy the engine-tier worker (Admin → AI)
- [ ] If you fork the protocol: pick your own `d`-tag/`t`-tag namespaces in
      `src/lib/communityIndex.ts` and `src/lib/moderation.ts` (or keep
      `uncaged-*` to federate)

---

## Event kinds & NIPs used

| Kind / NIP | Purpose |
|---|---|
| **NIP-50** | `search` filter keyword against search-capable relays |
| **39697** | SIP-01 web index observations (addressable, per-device indexer keys) — [spec](docs/SIP-01.md) |
| **30078** | Community link submissions + team role lists (NIP-78 application data) |
| **1985** | NIP-32 moderation labels ("hidden" results, team-signed) |
| **1984** | NIP-56 abuse reports (result card flag → admin inbox) |
| **5** | NIP-09 deletion (un-hide a result) |
| **27235** | NIP-98-flavored engine-AI admin auth (signed config writes) |
| **34967** | Referral pings (first-touch invite attribution, per-device key) |
| **6079** | Affiliate click attribution (pseudonymous, per-device key) |
| **NIP-66/11** | relay discovery: announcements → verified capability probing |
| **0** | Profile metadata (search results + author cards) |
| **1** | Notes (search results) |
| **1063** | File metadata, NIP-94 (search results; their `url` feeds auto-indexing) |
| **30023** | Long-form articles, NIP-23 (search results) |
| **30818** | Wiki articles, NIP-54 (search results) |
| **10002** | NIP-65 relay list (synced/published in Settings) |
| **NIP-19** | `npub`/`note`/`nevent`/`naddr`/`nprofile` routes at `/:nip19` |
| **NIP-31** | `alt` convention on all published events |

Full schemas and tag tables: **[NIP.md](NIP.md)**.

---

## Project structure

```
src/
├── lib/
│   ├── providers/
│   │   ├── types.ts          ← SearchResult / SearchProvider (the contract)
│   │   ├── registry.ts       ← provider catalog (add yours here)
│   │   ├── nostr.ts          ← NIP-50 relay search
│   │   ├── web-index.ts      ← SIP-01 kind 39697 index reader
│   │   └── community.ts      ← kind 30078 curated links
│   ├── ai/
│   │   ├── types.ts          ← AIProvider / AIEvidenceItem contracts
│   │   ├── registry.ts       ← AI provider catalog (PPQ, OpenRouter, …)
│   │   ├── openai-compatible.ts ← the one provider shape that covers all
│   │   ├── prompts.ts        ← evidence-cited answer prompts
│   │   ├── engineProxy.ts    ← server-side engine-AI logic (worker shell)
│   │   └── engineAdmin.ts    ← signed admin actions (kind 27235)
│   ├── webIndex.ts           ← SIP-01: URL normalization, build/parse/validate
│   ├── indexPublisher.ts     ← signs + publishes kind 39697 observations
│   ├── indexerIdentity.ts    ← per-device anonymous indexer keypair
│   ├── communityIndex.ts     ← submission schema (build + parse)
│   ├── moderation.ts         ← NIP-32 labels, roles, trust root
│   ├── reports.ts            ← NIP-56 abuse report builders
│   ├── referrals.ts          ← ?ref= attribution + click events (34967/6079)
│   ├── affiliates.ts         ← owner-managed host→code tagging rules
│   ├── appProfile.ts         ← UNCAGED identity + namespaces + permissions
│   ├── relayDiscovery.ts     ← NIP-66 candidates → NIP-11 verification
│   ├── aiConfig.ts           ← AI tiers + credential precedence (no bundled keys)
│   ├── corsProxy.ts          ← proxied fetch with failover (AI calls)
│   ├── queryParser.ts        ← structured queries (AND/OR/NOT/phrases/filters)
│   ├── queryEval.ts          ← client-side AST evaluation over documents
│   ├── queryClassify.ts      ← what KIND of query is this (AI gating)
│   ├── contentType.ts        ← link type detection + URL allowlist
│   ├── appRelays.ts          ← default relays + search relay pool
│   ├── searchRelays.ts       ← relay connections + pool query/publish
│   ├── sanitizeUrl.ts        ← URL sanitizer (https/http only)
│   └── nostrHelpers.ts       ← kind labels, timeAgo, nip19 helpers
├── hooks/
│   ├── useProviderSearch.ts  ← the orchestrator (parallel + merge + rank
│   │                           + moderation filtering)
│   ├── useSearchIndexer.ts   ← auto-indexing (SIP-01 publisher)
│   ├── useAIAnswer.ts        ← evidence pack → cited AI answer
│   ├── useModeration.ts      ← hidden set, reports inbox, team actions
│   ├── useAdminAccess.ts     ← role resolution (owner/admin/moderator)
│   ├── useAffiliates.ts      ← affiliate rules (read + owner/admin write)
│   ├── useReferrals.ts       ← referral config, click tracking, partner stats
│   ├── useEngineAIStatus.ts  ← /api/ai status probe
│   ├── useIndexStats.ts      ← admin stats counters
│   ├── useSearchRelayPool.ts ← search relay pool + latency tester
│   └── useSearchHotkeys.ts   ← Ctrl+K / "/" focus the search bar
├── components/
│   ├── SearchBar.tsx         ← the search input (hero + compact)
│   ├── SourceTabs.tsx        ← All / Nostr / Web tabs with counts
│   ├── ProviderStatus.tsx    ← live per-provider status + latency
│   ├── UnifiedResultCard.tsx ← one card for every result type (+ report flag)
│   ├── AIAnswerCard.tsx      ← the synthesized answer with [n] citations
│   ├── ReportDialog.tsx      ← NIP-56 report form
│   ├── ReferralCapture.tsx   ← ?ref= first-touch capture (mounts in App)
│   ├── SearchSkeleton.tsx    ← loading skeletons
│   ├── SubmitToIndex.tsx     ← community submission dialog
│   └── auth/                 ← Nostr login (signup, NIP-07, nsec, NIP-46)
├── pages/
│   ├── Index.tsx             ← hero + results (the whole search UX)
│   ├── Settings.tsx          ← theme, indexing, AI, relays (+ discovery)
│   ├── Admin.tsx             ← team console (stats/reports/moderation/AI/
│   │                           affiliates/invites/roles)
│   ├── Invite.tsx            ← referral links + partner stats
│   └── NIP19Page.tsx         ← profile/event rendering for /:nip19
└── scripts/
    └── seed-import.ts        ← corpus → SIP-01 observations (npm run seed)
```

## Privacy, honestly

- Searching needs **no login**. Reads are unauthenticated.
- Queries go to Nostr relays over WebSocket — relay operators see the query
  text and the connecting IP, but no account is linked.
- Auto-indexing publishes **document observations, never queries**, signed by
  a pseudonymous per-device key. Key separation is guaranteed; network
  anonymity is not (relays see IP/timing).
- There is no server-side anything. No analytics, no cookies, no logs.

## Tech stack

React 19 · TypeScript · Vite · TailwindCSS 4 · shadcn/ui · Nostrify ·
nostr-tools · TanStack Query · React Router

## License

MIT

---

*Vibed with [Shakespeare](https://shakespeare.diy)*

# Uncaged Engine — Event Kinds & Protocol Reference

Everything this template reads or writes on Nostr, in one file. The engine
uses standard NIPs wherever they exist and defines a handful of application
schemas of its own:

| Schema | Kind | Type | Defined in |
|--------|------|------|------------|
| Web Index Observation (SIP-01) | **39697** | addressable | [docs/SIP-01.md](docs/SIP-01.md) |
| Community Submission | **30078** | addressable (NIP-78) | this file, §2 |
| Moderation Label | **1985** | regular (NIP-32) | this file, §3 |
| Abuse Report | **1984** | regular (NIP-56) | this file, §4 |
| Team Role List | **30078** | addressable (NIP-78) | this file, §5 |
| Un-hide (retract a label) | **5** | regular (NIP-09) | this file, §3 |
| Engine-AI admin auth | **27235** | regular (NIP-98-flavored) | this file, §6 |

All published events carry an `alt` tag with a human-readable description.

---

## 1. Web Index Observations — kind 39697 (SIP-01)

The shared, decentralized document index. One addressable event per
`(indexer pubkey, normalized URL)` — an indexer's signed statement: *"I
observed this web page at this time, and here is its public metadata."*

- **Written by** the index publisher (`src/lib/indexPublisher.ts`) using the
  per-device indexer identity (`src/lib/indexerIdentity.ts`) — **never** the
  user's personal key, and **never** containing the search query. Called by
  the auto-indexer (`src/hooks/useSearchIndexer.ts`) for web pages discovered
  during search (file-metadata URLs, links cited by Nostr content, and any
  external-provider results), and by the Submit dialog
  (`src/components/SubmitToIndex.tsx`) for http(s) community submissions.
- **Read by** the Web Index provider (`src/lib/providers/web-index.ts`),
  which groups observations by `d` tag and ranks by independent indexer
  count + recency.
- **Implemented in** `src/lib/webIndex.ts` (build / parse / validate /
  normalize), covered by `src/lib/webIndex.test.ts`.

```json
{
  "kind": 39697,
  "content": "{\"title\":\"Example Page\",\"description\":\"…\",\"image\":\"https://…\"}",
  "tags": [
    ["d", "widx:9f86d081884c7d659a2feaa0c55ad015"],
    ["u", "https://example.com/page"],
    ["t", "nostr"], ["t", "privacy"],
    ["l", "en"],
    ["x", "<sha256(title + \"\\n\" + description)>"],
    ["v", "1"],
    ["published", "1754600000"],
    ["source", "uncaged-engine/1"],
    ["alt", "Web index observation: Example Page"]
  ]
}
```

| Tag | Required | Meaning |
|-----|----------|---------|
| `d` | ✔ | `"widx:" + sha256(normalized_url)[0:32]` — URL identity; identical across all indexers |
| `u` | ✔ | Canonical URL (http/https only, ≤ 2048 chars, allowlisted) |
| `v` | ✔ | Schema version, currently `"1"` |
| `t` | – | 0–8 topic tags matching `^[a-z0-9][a-z0-9-]{0,99}$` (relay-filterable) |
| `l` | – | ISO 639-1 language code (two-letter shape enforced) |
| `x` | – | Content hash `sha256(title + "\n" + description)` (agreement/freshness signal) |
| `published` | – | Page's claimed publication time (unix seconds) |
| `source` | – | Indexer software id, ≤ 100 chars (informational; the pubkey is the identity) |
| `alt` | ✔ | `alt`-convention description ("Web index observation: …") |
| `type` | – | §9.2 extension — document type: `page`, `article`, `repository`, `video`, … (emitted by community submissions) |
| `platform` | – | §9.2 extension — source platform: `github`, `youtube`, … |
| `category` | – | §9.2 extension — engine-defined content category |
| `network` | – | §9.2 extension — `clearnet`, `tor`, `i2p`, … (emitted for `.onion` submissions) |
| `country` | – | §9.2 extension — ISO 3166-1 alpha-2, uppercase |
| `mime` | – | §9.2 extension — document media type |

Extensions are optional and ignored by consumers that don't know them
(spec §9.1) — the engine parses them into `observation.extensions` and the
Web Index provider surfaces `type` as the result badge.

The **full protocol specification** — normalization rules, field caps,
test vectors (§13), relay operators (§15), search-node behavior (§18) —
lives in **[docs/SIP-01.md](docs/SIP-01.md)**, mirrored from the canonical
[SIP-01 repository](https://github.com/NostrDanish/SIP-01). It is
deliberately app-independent: any client, crawler, or relay can implement
SIP-01 and read the same shared index.

---

## 2. Community Submissions — kind 30078 (NIP-78)

User-curated links. Any logged-in user can submit (Submit button →
`src/components/SubmitToIndex.tsx`); the event is signed by the **user's own
key**, so curation is attributable and spam is author-filterable.

- **Built in** `src/lib/communityIndex.ts` (`buildSubmissionEvent`).
- **Read by** the Community provider (`src/lib/providers/community.ts`):
  fetches recent `#t: uncaged-submit` events and AND-matches the query
  client-side across title, description, URL, and tags.
- **Dual-published:** http(s) submissions also become SIP-01 observations
  (kind 39697, §1) signed by the device indexer identity — one submission
  feeds both the curated index and the shared document index.

```json
{
  "kind": 30078,
  "content": "<description — shown as the search snippet>",
  "tags": [
    ["d", "uncaged:submit:9f86d081884c7d659a2feaa0"],
    ["t", "uncaged-submit"],
    ["t", "web"],
    ["t", "privacy"], ["t", "tools"],
    ["title", "Example Page"],
    ["url", "https://example.com/page"],
    ["type", "web"],
    ["alt", "Community index submission: Example Page"]
  ]
}
```

| Tag | Required | Meaning |
|-----|----------|---------|
| `d` | ✔ | `"uncaged:submit:" + sha256(lowercased url)[0:24]` — deterministic, so re-submitting replaces the author's earlier entry |
| `t` = `uncaged-submit` | ✔ | Marker tag — this is what relays filter on |
| `t` = `<type>` | ✔ | Content type: `web` `torrent` `ipfs` `video` `audio` `pdf` `onion` `other` |
| `t` = `<topic>` | – | Up to 8 free-form user tags (lowercased, spaces → `-`) |
| `title` | ✔ | Display title |
| `url` | ✔ | The link. Allowed schemes: `https:`, `http:`, `magnet:`, `ipfs:`/`ipns:` (see `isValidSubmissionUrl` in `src/lib/contentType.ts`) |
| `type` | ✔ | Same content type as the `t` tag, for clients that don't scan `t` |
| `alt` | ✔ | NIP-31 description |

**Forking note:** to federate with other Uncaged-based engines, keep the
`uncaged-*` namespace. To run an isolated index, change `COMMUNITY_T_TAG` and
`COMMUNITY_D_PREFIX` in `src/lib/communityIndex.ts`.

---

## 3. Moderation Labels — kind 1985 (NIP-32)

Team-signed result filtering. Hiding a result publishes a label; every
client filters its result lists against labels from **trusted pubkeys only**
(owner + role lists — the author filter is the trust boundary). Un-hiding
publishes a NIP-09 deletion (`kind 5`, `e` tag = the label event id).

```json
{
  "kind": 1985,
  "content": "",
  "tags": [
    ["L", "uncaged.moderation"],
    ["l", "hidden", "uncaged.moderation"],
    ["u", "<normalized-url>"],
    ["alt", "Uncaged Engine moderation: hidden <url>"]
  ]
}
```

Targets: `u` (a SIP-01-normalized URL) or `e` (a 64-hex Nostr event id).
Implemented in `src/lib/moderation.ts`; applied to every search in
`src/hooks/useProviderSearch.ts`.

## 4. Abuse Reports — kind 1984 (NIP-56)

Filed from any result card's flag button (`src/components/ReportDialog.tsx`),
signed by the reporter's own key (attributable, Sybil-resistant). Self-labeled
so moderators can filter the inbox by namespace:

```json
{
  "kind": 1984,
  "content": "<free-text details>",
  "tags": [
    ["r", "<url>", "<type>"],
    ["L", "uncaged.abuse"],
    ["l", "<type>", "uncaged.abuse"],
    ["alt", "Abuse report (<type>)"]
  ]
}
```

The target tag follows NIP-56: `r` for URLs, `e` for events, `p` for
profiles, `a` for addressable events (builders in `src/lib/reports.ts`).
Types: `illegal`, `malware`, `spam`, `nudity`, `profanity`, `impersonation`,
`other`. The Admin → Reports inbox turns a report into a moderation label
in one click.

## 5. Team Role Lists — kind 30078 (NIP-78)

Owner-managed team rosters, resolved live by every client. Content is a JSON
array of hex pubkeys; readers trust the **owner's signature only** — the
d-tag alone is not a trust boundary (`authors: [OWNER_PUBKEY]` filter).

```json
{
  "kind": 30078,
  "content": "[\"<admin-pubkey-hex>\", …]",
  "tags": [
    ["d", "uncaged:admin-roles"],
    ["t", "uncaged-roles"],
    ["alt", "Uncaged Engine admin list"]
  ]
}
```

Two lists exist: `uncaged:admin-roles` and `uncaged:mod-roles`. Managed in
Admin → Roles (`src/pages/Admin.tsx`); resolved in `src/hooks/useAdminAccess.ts`.

## 6. Engine-AI admin auth — kind 27235 (NIP-98-flavored)

The Admin → AI tab manages the engine-provided AI tier without accounts or
passwords: each config write is a signed kind 27235 event (content = the
JSON action, tags `u` + `method`), base64-encoded into the proxy's
`Authorization: Nostr <…>` header. The worker verifies the Schnorr
signature, the owner pubkey, a 5-minute freshness window, and the URL/method
binding (`src/lib/ai/engineProxy.ts` → `verifyAdminAuth`; client side:
`src/lib/ai/engineAdmin.ts`). The AI key itself only travels this one
authenticated path.

**Note:** the AI answer layer writes nothing to Nostr — answers are
ephemeral and never indexed into SIP-01.

## 7. Standard kinds searched (read-only)

The Nostr provider (`src/lib/providers/nostr.ts`) issues **NIP-50** `search`
filters against the search relay pool:

```json
{ "search": "<query>", "kinds": [0, 1, 1063, 30023, 30818], "limit": 40 }
```

| Kind | NIP | What it is | How results link |
|------|-----|-----------|------------------|
| 0 | NIP-01 | Profile metadata | `/npub1…` |
| 1 | NIP-01 | Short text notes | `/nevent1…` |
| 1063 | NIP-94 | File metadata | `/nevent1…` |
| 30023 | NIP-23 | Long-form articles | `/naddr1…` |
| 30818 | NIP-54 | Wiki articles | `/naddr1…` |

Client-side, the provider drops hashtag/link-stuffed spam notes, extracts a
query-relevant snippet window, and encodes results as NIP-19 routes rendered
by `src/pages/NIP19Page.tsx`.

---

## 8. Other NIPs in play

| NIP | Kind / feature | Where |
|-----|----------------|-------|
| NIP-65 | **10002** relay list metadata — synced on login, published on edit | `src/components/NostrSync.tsx`, `src/components/RelayListManager.tsx` |
| NIP-19 | bech32 identifiers — `npub` `note` `nevent` `naddr` `nprofile` all route at `/:nip19` | `src/pages/NIP19Page.tsx` |
| `alt` convention (NIP-31 origin) | `alt` tags on every published event | `webIndex.ts`, `communityIndex.ts`, `moderation.ts`, `reports.ts` |
| NIP-32 | **1985** moderation labels (`L`/`l` namespace tags) | `src/lib/moderation.ts` |
| NIP-56 | **1984** abuse reports | `src/lib/reports.ts` |
| NIP-09 | **5** deletion requests (un-hide) | `src/lib/moderation.ts` |
| NIP-07 | browser extension signing | `src/components/auth/` |
| NIP-46 | remote signer (nostrconnect / bunker) | `src/components/auth/` |
| NIP-42 | relay AUTH (signed 22242 challenge responses) | `src/components/NostrProvider.tsx` |
| NIP-98 | flavor of the engine-AI admin auth (kind 27235, signed URL+method binding) | `src/lib/ai/engineProxy.ts` |

---

## 9. Trust model

- **Index observations (39697):** trusted *structurally* — any indexer pubkey
  is accepted; events are self-signed statements about public metadata and
  are validated on parse (schema version, URL allowlist, field caps) and
  integrity-checked before display (`d` ↔ normalized `u`, `x` ↔ content —
  spec §18). Agreement across independent indexers is the ranking signal.
- **Community submissions (30078):** trusted *socially* — attributable to
  their author. Clients may later filter by author (follow graph, allowlists)
  without a schema change.
- **Searched content (0/1/1063/30023/30818):** public UGC — no author
  filtering, rendered with React escaping; event-sourced URLs pass
  `sanitizeUrl()` (https/http only) before reaching the DOM.
- **Moderation (1985/5) and roles (30078):** trusted *by author* — labels
  count only from the owner + owner-listed team keys; role lists only from
  the owner. `OWNER_PUBKEY` in `src/lib/moderation.ts` is the trust root —
  forks must replace it.
- **Reports (1984):** trusted *socially* — attributable to the reporter;
  they inform the team but never filter anything by themselves.

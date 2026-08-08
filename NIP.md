# Uncaged Engine — Event Kinds & Protocol Reference

Everything this template reads or writes on Nostr, in one file. The engine
uses standard NIPs wherever they exist and defines exactly two application
schemas of its own:

| Schema | Kind | Type | Defined in |
|--------|------|------|------------|
| Web Index Observation (SIP-01) | **39697** | addressable | [docs/SEARCH_INDEX_PROTOCOL.md](docs/SEARCH_INDEX_PROTOCOL.md) |
| Community Submission | **30078** | addressable (NIP-78) | this file, §2 |

All published events carry a NIP-31 `alt` tag with a human-readable
description.

---

## 1. Web Index Observations — kind 39697 (SIP-01)

The shared, decentralized document index. One addressable event per
`(indexer pubkey, normalized URL)` — an indexer's signed statement: *"I
observed this web page at this time, and here is its public metadata."*

- **Written by** the auto-indexer (`src/hooks/useSearchIndexer.ts`) using the
  per-device indexer identity (`src/lib/indexerIdentity.ts`) — **never** the
  user's personal key, and **never** containing the search query.
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
| `u` | ✔ | Canonical URL (http/https only, allowlisted) |
| `v` | ✔ | Schema version, currently `"1"` |
| `t` | – | 0–8 lowercase topic tags (relay-filterable) |
| `l` | – | ISO 639-1 language code |
| `x` | – | Content hash (agreement/freshness signal) |
| `published` | – | Page's claimed publication time (unix seconds) |
| `source` | – | Indexer software id (informational; the pubkey is the identity) |
| `alt` | ✔ | NIP-31 description |

The **full protocol specification** — normalization rules, field caps,
security requirements, relay guidance, search-node behavior — lives in
**[docs/SEARCH_INDEX_PROTOCOL.md](docs/SEARCH_INDEX_PROTOCOL.md)**. It is
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

## 3. Standard kinds searched (read-only)

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

## 4. Other NIPs in play

| NIP | Kind / feature | Where |
|-----|----------------|-------|
| NIP-65 | **10002** relay list metadata — synced on login, published on edit | `src/components/NostrSync.tsx`, `src/components/RelayListManager.tsx` |
| NIP-19 | bech32 identifiers — `npub` `note` `nevent` `naddr` `nprofile` all route at `/:nip19` | `src/pages/NIP19Page.tsx` |
| NIP-31 | `alt` tags on every published event | `webIndex.ts`, `communityIndex.ts` |
| NIP-07 | browser extension signing | `src/components/auth/` |
| NIP-46 | remote signer (nostrconnect / bunker) | `src/components/auth/` |
| NIP-42 | relay AUTH (signed 22242 challenge responses) | `src/components/NostrProvider.tsx` |

---

## 5. Trust model

- **Index observations (39697):** trusted *structurally* — any indexer pubkey
  is accepted; events are self-signed statements about public metadata and
  are validated on parse (schema version, URL allowlist, field caps).
  Agreement across independent indexers is the ranking signal.
- **Community submissions (30078):** trusted *socially* — attributable to
  their author. Clients may later filter by author (follow graph, allowlists)
  without a schema change.
- **Searched content (0/1/1063/30023/30818):** public UGC — no author
  filtering, rendered with React escaping; event-sourced URLs pass
  `sanitizeUrl()` (https/http only) before reaching the DOM.

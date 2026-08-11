# Seeding the Index (bootstrap guide)

A decentralized search engine has a cold-start problem: on day one the index
is empty, and crawlers discover the web slowly. Seeding fixes that — convert
an existing web-metadata corpus into SIP-01 observations and the index starts
with hundreds of thousands of known documents instead of zero.

```
OfflineWebSearch datasets (.db / .json)        any other corpus…
              │                                        │
              └──────────────┬─────────────────────────┘
                             ▼
                  scripts/seed-import.ts
                  (normalize · dedupe · shard)
                             │
                             ▼
              seed-*.jsonl — unsigned SIP-01
              event templates (kind 39697)
                             │
                ┌────────────┴────────────┐
                ▼                         ▼
        this script (--publish)     your own crawler/seeder
        paced signing + fan-out     (sign with any indexer key)
                │
                ▼
      SIP-01 index relays (relay-na1.metanomalist.com, …)
                │
                ▼
   every SIP-01 engine sees the documents — including this one
   (Web Index provider; no client changes needed)
```

---

## 1. The reference corpus: OfflineWebSearch

[OfflineWebSearch](https://github.com/rumca-js/OfflineWebSearch) is a
privacy-first offline search app backed by curated SQLite databases of web
metadata (title, description, thumbnails). The author publishes ready-made
datasets and maintains the format in
[linkarchivetools](https://github.com/rumca-js/linkarchivetools).

Datasets live at `https://rumca-js.github.io/data/`:

| File | Contents |
|------|----------|
| `top.db.zip` | Top sites |
| `awesomelists.db.zip` | Awesome lists (great OSS/discovery hubs) |
| `books.db.zip` | Books |
| `movies.db.zip` | Movies |
| `music.db.zip` | Music |
| `videogames.db.zip` | Video games |
| `youtube.db.zip` | YouTube channels |
| `feeds.db.zip` | RSS/feed sources |
| `memes.db.zip` | Memes |

**Provenance & licensing:** the converter in this repo is MIT. The datasets
are someone else's curation work (the app is GPL-3.0) — review the source
project's terms before republishing converted data at scale. We convert and
reference; we do not vendor or redistribute their databases.

## 2. Converting a dataset

```bash
# 1. Download + unzip a dataset
curl -LO https://rumca-js.github.io/data/top.db.zip
unzip top.db.zip        # produces top.db

# 2. Convert to SIP-01 (dry run — writes seed-top.jsonl, prints stats)
npm run seed -- top.db
```

The importer (`scripts/seed-import.ts`):

- reads linkarchivetools SQLite directly (`linkdatamodel` table, tags joined
  from `entrycompactedtags`) — also accepts `.json` / `.jsonl` row exports
- normalizes every URL through `src/lib/webIndex.ts`, so `d`/`x` values are
  **byte-compatible** with the spec §13 test vectors and every ecosystem
  implementation
- dedupes by normalized URL, drops non-http(s) and unusable rows, falls back
  to the hostname when a row has no title
- tags each output event with `["x-seed", "offlinewebsearch:<dataset>"]` —
  an experimental provenance marker per spec §9.1 rule 6
- prints a stats summary (kept / dupes / dropped, top domains)

Output is JSONL of **unsigned** event templates (`{ kind, content, tags }`),
one per line — inspectable, diffable, and signable by any tooling.

## 3. Publishing

Observations must be signed by an **indexer key** — a pseudonymous keypair,
not your personal Nostr identity (spec §14). Any nsec works; generate a
dedicated one for seeding (`nak key generate`, or Settings → Indexing →
Export key in the app for a device identity).

```bash
npm run seed -- top.db \
  --publish \
  --nsec nsec1... \
  --relay wss://relay-na1.metanomalist.com/ \
  --relay wss://relay.ditto.pub/ \
  --pace 200
```

- Publishing is **paced** (`--pace` ms between events) and best-effort per
  relay — be a good citizen; the addressable `d`-tag design means re-runs
  replace rather than duplicate, but relays still pay ingestion cost.
- Default publish targets are the SIP-01 index network
  (`relay-na1.metanomalist.com`, `relay.ditto.pub`).
- `--limit N` caps the corpus (useful for test runs).

## 4. Sharding — dividing the corpus between crawlers

`--shard i/n` partitions the corpus deterministically (the normalized URL
decides the shard), so N independent processes can seed or crawl different
slices with zero coordination:

```bash
npm run seed -- top.db --shard 1/4 --publish --nsec …   # machine A
npm run seed -- top.db --shard 2/4 --publish --nsec …   # machine B
…
```

The same flag works as a **crawl queue partitioner**: shard the seed file,
hand each crawler its slice, and every crawler refreshes its share of the
web into fresh observations. Because `d` tags are deterministic, overlaps
between crawlers are harmless — they just become additional independent
observations of the same document (which is the ranking signal, not waste).

## 5. What to crawl first (priority classes)

A seed corpus doubles as a crawl queue with a mission. Suggested classes,
highest value first for this ecosystem:

| Priority | Class | Why |
|---|---|---|
| 0 | Nostr / fediverse / decentralized web | the network's own fabric |
| 1 | Privacy / freedom / cypherpunk | the audience's core interest |
| 2 | Open source / forges | high-value, stable content |
| 3 | Independent websites | what clearnet engines bury |
| 4 | Blogs / RSS / news | freshness drivers |
| 5 | Forums / communities | long-tail knowledge |
| 6 | Academic / documentation | reference material |
| 7 | General web | everything else |
| 8 | Long-tail discovery | expansion frontier |

The OfflineWebSearch datasets map neatly onto several of these
(`awesomelists` → 2, `feeds` → 4, `top` → 7). A `--class` mapping is left to
crawler-side tooling; the seed format carries topics (`t` tags) that engines
can already filter on.

## 6. Beyond seeding: the three-layer model

SIP-01 deliberately carries only **Layer A — discovery metadata**
(URL, title, description, topics, language). Heavier layers stay off the
relay layer:

- **Layer B — search index** (tokens, BM25, link graph, authority):
  computed and held by index relays / search nodes. Never published.
- **Layer C — content**: the pages themselves. Referenced by URL + content
  hash (`x`), fetched and held by crawlers/cache nodes. Never published.

This keeps Nostr events small and the protocol lean: relays move kilobytes
of metadata per document, not megabytes of page content.

## 7. Other corpora worth importing

The importer accepts any row-shaped JSON/JSONL, so these plug in the same way:

- **Internet-Places-Database** — domain-level discovery
  (github.com/rumca-js/Internet-Places-Database)
- **RSS/feed databases** — fresh-content discovery
- **Common Crawl indexes** — massive-scale discovery (pre-filter hard;
  the web is mostly spam)
- **Awesome lists / bookmark exports** — small but high-signal

Every source becomes the same thing: SIP-01 observations on relays, readable
by every engine in the network.

---

*See also: [SIP-01 specification](SIP-01.md) ·
[canonical repo + ecosystem docs](https://github.com/NostrDanish/SIP-01)*

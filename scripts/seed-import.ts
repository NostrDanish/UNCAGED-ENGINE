/**
 * UNCAGED seed importer — converts web-metadata databases into SIP-01 web
 * index observations (kind 39697), ready to sign and publish.
 *
 * The point: bootstrap the shared index with a large, curated corpus instead
 * of waiting for crawlers to discover the web from zero. The reference source
 * is the OfflineWebSearch / linkarchivetools ecosystem
 * (https://github.com/rumca-js/OfflineWebSearch — ready-made SQLite datasets
 * at https://rumca-js.github.io/data/, e.g. top.db.zip, awesomelists.db.zip).
 *
 * Byte-compatibility: URL normalization and hashing go through the app's own
 * SIP-01 reference implementation (src/lib/webIndex.ts), so every `d` and `x`
 * matches the spec §13 test vectors and every other ecosystem implementation.
 *
 * ─── Input formats ──────────────────────────────────────────────────────
 *
 *   .db       SQLite database in linkarchivetools format (main table:
 *             `linkdatamodel`; tags joined from `entrycompactedtags`).
 *             Requires Node ≥ 22.5 (built-in node:sqlite).
 *             Unzip .db.zip datasets first (`unzip top.db.zip`).
 *   .json     Array of row objects (e.g. from linkarchivetools' Db2JSON).
 *   .jsonl    One row object per line.
 *
 *   Row fields used (all optional except the link): link/url, title,
 *   description, language, thumbnail, date_published, tags (array or
 *   comma string).
 *
 * ─── Usage ──────────────────────────────────────────────────────────────
 *
 *   npm run seed -- top.db                          # convert → seed-top.jsonl
 *   npm run seed -- top.db -o corpus.jsonl          # custom output path
 *   npm run seed -- top.db --shard 2/8              # deterministic shard 2 of 8
 *   npm run seed -- top.db --source my-crawler/1    # custom source tag
 *   npm run seed -- top.db --publish --nsec nsec1…  # convert AND publish
 *       --relay wss://relay-na1.metanomalist.com/   # (repeatable relay target)
 *       --pace 200                                  # ms between publishes
 *
 * Default relays for --publish: the SIP-01 index network
 * (relay-na1.metanomalist.com + relay.ditto.pub).
 *
 * Output: JSONL of unsigned event templates ({ kind, content, tags }) —
 * one SIP-01 observation per line, deduplicated by document id. Publish them
 * with this script or hand the file to any crawler/seeder that signs SIP-01.
 *
 * Licensing note: the converter code here is MIT (this repo). The *datasets*
 * you feed it have their own provenance — check the source project's terms
 * before republishing converted data at scale.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

import { finalizeEvent } from 'nostr-tools/pure';
import { nip19 } from 'nostr-tools';
import { NRelay1 } from '@nostrify/nostrify';

import { buildIndexEvent, normalizeIndexUrl } from '../src/lib/webIndex.ts';

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

interface CliOptions {
  input: string;
  output?: string;
  source: string;
  shard?: { index: number; of: number };
  publish: boolean;
  nsec?: string;
  relays: string[];
  paceMs: number;
  limit?: number;
}

const DEFAULT_PUBLISH_RELAYS = [
  'wss://relay-na1.metanomalist.com/',
  'wss://relay.ditto.pub/',
];

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    input: '',
    source: 'uncaged-seed/1',
    publish: false,
    relays: [],
    paceMs: 150,
  };

  const args = [...argv];
  while (args.length > 0) {
    const arg = args.shift()!;
    switch (arg) {
      case '-o':
      case '--output':
        opts.output = args.shift();
        break;
      case '--source':
        opts.source = args.shift() ?? opts.source;
        break;
      case '--shard': {
        const raw = args.shift() ?? '';
        const m = raw.match(/^(\d+)\s*\/\s*(\d+)$/);
        if (!m) throw new Error('--shard expects "<index>/<total>", e.g. 2/8');
        const index = parseInt(m[1], 10);
        const of = parseInt(m[2], 10);
        if (index < 1 || index > of) throw new Error('--shard index must be in 1..total');
        opts.shard = { index, of };
        break;
      }
      case '--publish':
        opts.publish = true;
        break;
      case '--nsec':
        opts.nsec = args.shift();
        break;
      case '--relay': {
        const url = args.shift();
        if (url) opts.relays.push(url);
        break;
      }
      case '--pace': {
        const n = parseInt(args.shift() ?? '', 10);
        if (Number.isFinite(n) && n >= 0) opts.paceMs = n;
        break;
      }
      case '--limit': {
        const n = parseInt(args.shift() ?? '', 10);
        if (Number.isFinite(n) && n > 0) opts.limit = n;
        break;
      }
      default:
        if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
        if (opts.input) throw new Error(`Unexpected extra argument: ${arg}`);
        opts.input = arg;
    }
  }

  if (!opts.input) {
    throw new Error('Missing input file (.db, .json, or .jsonl). See header comment for usage.');
  }
  if (opts.publish && !opts.nsec) {
    throw new Error('--publish requires --nsec <nsec1…> (the indexer key that signs observations)');
  }
  if (opts.relays.length === 0) opts.relays = DEFAULT_PUBLISH_RELAYS;
  return opts;
}

/* ------------------------------------------------------------------ */
/* Input readers — normalize every source into row objects             */
/* ------------------------------------------------------------------ */

type Row = Record<string, unknown>;

function readJsonRows(path: string): Row[] {
  const raw = readFileSync(path, 'utf8');
  if (path.endsWith('.jsonl')) {
    return raw
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Row);
  }
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error(`${path}: expected a JSON array of rows`);
  return parsed as Row[];
}

/**
 * Read a linkarchivetools-format SQLite database (OfflineWebSearch datasets).
 * Main table: `linkdatamodel`; tags joined from `entrycompactedtags`
 * when that table exists.
 *
 * Uses the built-in node:sqlite module (Node ≥ 22.5; on versions where it is
 * still flagged, run with NODE_OPTIONS=--experimental-sqlite). Dynamically
 * imported so JSON/JSONL inputs work on any Node version.
 */
async function readSqliteRows(path: string): Promise<Row[]> {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path, { readOnly: true });

  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    const tableNames = new Set(tables.map((t) => t.name));

    const entryTable = tableNames.has('linkdatamodel') ? 'linkdatamodel' : undefined;
    if (!entryTable) {
      throw new Error(
        `${path}: no linkdatamodel table (found: ${[...tableNames].join(', ') || 'none'}). ` +
        'Expected a linkarchivetools-format database.',
      );
    }

    const rows = db.prepare(`SELECT * FROM ${entryTable}`).all() as Row[];

    if (tableNames.has('entrycompactedtags')) {
      const tagRows = db
        .prepare('SELECT entry_id, tag FROM entrycompactedtags')
        .all() as { entry_id: number; tag: string }[];
      const byEntry = new Map<number, string[]>();
      for (const t of tagRows) {
        const list = byEntry.get(t.entry_id) ?? [];
        list.push(t.tag);
        byEntry.set(t.entry_id, list);
      }
      for (const row of rows) {
        const id = row.id as number | undefined;
        if (id !== undefined && byEntry.has(id)) row.tags = byEntry.get(id);
      }
    }

    return rows;
  } finally {
    db.close();
  }
}

function readRows(path: string): Promise<Row[]> | Row[] {
  if (path.endsWith('.db')) return readSqliteRows(path);
  if (path.endsWith('.json') || path.endsWith('.jsonl')) return readJsonRows(path);
  throw new Error(`Unsupported input format: ${path} (use .db, .json, or .jsonl)`);
}

/* ------------------------------------------------------------------ */
/* Row → observation input mapping (defensive: columns vary by export) */
/* ------------------------------------------------------------------ */

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function unixSeconds(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Heuristic: ms timestamps are 13 digits.
    return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return Math.floor(parsed / 1000);
  }
  return undefined;
}

function rowToTags(row: Row): string[] {
  const raw = row.tags ?? row.tag;
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') return raw.split(',').map((t) => t.trim());
  return [];
}

/* ------------------------------------------------------------------ */
/* Convert                                                             */
/* ------------------------------------------------------------------ */

interface ConvertStats {
  rows: number;
  kept: number;
  dupes: number;
  noUrl: number;
  badUrl: number;
  shardedOut: number;
  domains: Map<string, number>;
}

async function convert(opts: CliOptions) {
  const rows = await readRows(opts.input);
  const stats: ConvertStats = {
    rows: rows.length, kept: 0, dupes: 0, noUrl: 0, badUrl: 0, shardedOut: 0,
    domains: new Map(),
  };

  const dataset = basename(opts.input).replace(/\.(db|jsonl?|zip)$/i, '');
  const seen = new Set<string>(); // normalized URLs — dedupe across the corpus
  const out: string[] = [];
  const limit = opts.limit ?? Infinity;

  for (const row of rows) {
    if (out.length >= limit) break;

    const url = str(row.link) || str(row.url);
    if (!url) { stats.noUrl++; continue; }

    // Normalize via the reference implementation — byte-compatible `d` tags.
    const normalized = normalizeIndexUrl(url);
    if (!normalized) { stats.badUrl++; continue; }
    if (seen.has(normalized)) { stats.dupes++; continue; }

    // Deterministic sharding: same URL always lands in the same shard,
    // so N crawler processes can partition the corpus without coordination.
    if (opts.shard) {
      const shardKey = parseInt(normalized.replace(/\W/g, '').slice(-8), 16) || 0;
      if (shardKey % opts.shard.of !== opts.shard.index - 1) {
        stats.shardedOut++;
        continue;
      }
    }
    seen.add(normalized);

    const host = (() => { try { return new URL(normalized).hostname; } catch { return ''; } })();
    // Title is required by the spec; fall back to the host for bare links.
    const title = str(row.title).trim() || host;
    if (!title) { stats.badUrl++; continue; }

    const template = await buildIndexEvent({
      url: normalized,
      title,
      description: str(row.description),
      image: str(row.thumbnail),
      tags: rowToTags(row),
      language: str(row.language),
      published: unixSeconds(row.date_published ?? row.published),
      source: opts.source,
    });
    if (!template) { stats.badUrl++; continue; }

    // Provenance marker — experimental extension tag per spec §9.1 rule 6.
    template.tags.push(['x-seed', `offlinewebsearch:${dataset}`.slice(0, 50)]);

    out.push(JSON.stringify(template));
    stats.kept++;
    if (host) stats.domains.set(host, (stats.domains.get(host) ?? 0) + 1);
  }

  return { lines: out, stats, dataset };
}

/* ------------------------------------------------------------------ */
/* Optional publish                                                    */
/* ------------------------------------------------------------------ */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function publish(lines: string[], opts: CliOptions): Promise<void> {
  const decoded = nip19.decode(opts.nsec!);
  if (decoded.type !== 'nsec') throw new Error('--nsec must be an nsec1… key');
  const secretKey = decoded.data as Uint8Array;

  const relays = opts.relays.map((url) => new NRelay1(url));
  console.log(`\nPublishing ${lines.length} observations to ${opts.relays.join(', ')}`);
  console.log(`Pace: ${opts.paceMs}ms between events. Ctrl+C to stop (progress is lost).\n`);

  let ok = 0;
  let failed = 0;
  for (let i = 0; i < lines.length; i++) {
    const template = JSON.parse(lines[i]) as { kind: number; content: string; tags: string[][] };
    const event = finalizeEvent(
      { ...template, created_at: Math.floor(Date.now() / 1000) },
      secretKey,
    );
    // Best-effort fan-out; a single relay accepting it is enough.
    const results = await Promise.allSettled(relays.map((r) => r.event(event)));
    if (results.some((r) => r.status === 'fulfilled')) ok++;
    else failed++;

    if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${lines.length} published (${ok} ok, ${failed} failed)`);
    if (opts.paceMs > 0) await sleep(opts.paceMs);
  }
  console.log(`\nDone: ${ok} published, ${failed} failed.`);
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { lines, stats, dataset } = await convert(opts);

  const output = opts.output ?? `seed-${dataset}.jsonl`;
  writeFileSync(output, lines.join('\n') + (lines.length > 0 ? '\n' : ''));

  const topDomains = [...stats.domains.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  console.log(`\nSeed import: ${opts.input}`);
  console.log(`  rows read:      ${stats.rows}`);
  console.log(`  observations:   ${stats.kept}`);
  console.log(`  duplicates:     ${stats.dupes}`);
  console.log(`  skipped (no url):    ${stats.noUrl}`);
  console.log(`  skipped (bad url):   ${stats.badUrl}`);
  if (opts.shard) console.log(`  other shards:   ${stats.shardedOut} (kept shard ${opts.shard.index}/${opts.shard.of})`);
  if (topDomains.length > 0) {
    console.log('  top domains:');
    for (const [domain, count] of topDomains) console.log(`    ${count.toString().padStart(6)}  ${domain}`);
  }
  console.log(`\nWrote ${output} — unsigned SIP-01 event templates (kind 39697), one per line.`);

  if (opts.publish) {
    await publish(lines, opts);
  } else {
    console.log('Dry run (no --publish). To publish: re-run with --publish --nsec nsec1…');
  }
}

main().catch((err: unknown) => {
  console.error(`\nseed-import failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

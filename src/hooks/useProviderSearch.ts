/**
 * Unified search hook — the orchestrator. Runs all registered providers in
 * parallel, streams per-provider status, merges + deduplicates + ranks the
 * results, and triggers auto-indexing.
 *
 * Each provider resolves independently so the UI can show live progress:
 *   ✔ Web Index (90ms)   ✔ Nostr (240ms)   ⏳ Community...
 *
 * Usage:
 *   const { results, providers, isLoading, isEmpty, counts } =
 *     useProviderSearch({ query, source: 'all' });
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { SearchResult, SearchSource, ProviderSearchResponse } from '@/lib/providers/types';
import { getProvidersForSource } from '@/lib/providers/registry';
import { useSearchIndexer } from '@/hooks/useSearchIndexer';

export type ProviderStatus = 'idle' | 'searching' | 'done' | 'error';

export interface ProviderState {
  id: string;
  name: string;
  source: SearchSource;
  status: ProviderStatus;
  resultCount: number;
  latencyMs?: number;
}

export interface UseProviderSearchOptions {
  query: string;
  source: SearchSource | 'all';
  enabled?: boolean;
}

export interface UseProviderSearchResult {
  /** All results from all providers, merged and sorted. */
  results: SearchResult[];
  /** Per-provider status for progress indicators. */
  providers: ProviderState[];
  /** Overall loading state (at least one provider still searching). */
  isLoading: boolean;
  /** At least one provider is fetching (initial or refetch). */
  isFetching: boolean;
  /** All providers finished but no results found. */
  isEmpty: boolean;
  /** Search suggestions from providers. */
  suggestions: string[];
  /** Count of results per source category. */
  counts: Record<SearchSource | 'all', number>;
}

export function useProviderSearch({
  query,
  source,
  enabled = true,
}: UseProviderSearchOptions): UseProviderSearchResult {
  const queryClient = useQueryClient();
  const activeProviders = useMemo(() => getProvidersForSource(source), [source]);
  const { indexResults } = useSearchIndexer();

  // Provider states tracked outside React Query for per-provider granularity.
  const [providerStates, setProviderStates] = useState<Map<string, ProviderState>>(new Map());

  const updateProviderState = useCallback((id: string, update: Partial<ProviderState>) => {
    setProviderStates((prev) => {
      const next = new Map(prev);
      const existing = next.get(id);
      if (existing) {
        next.set(id, { ...existing, ...update });
      }
      return next;
    });
  }, []);

  // Main query — runs all providers in parallel.
  const { data, isFetching } = useQuery<{
    results: SearchResult[];
    suggestions: string[];
  }>({
    queryKey: ['provider-search', query, source],
    queryFn: async ({ signal }) => {
      if (!query.trim()) return { results: [], suggestions: [] };

      // Initialize provider states.
      const initialStates = new Map<string, ProviderState>();
      for (const p of activeProviders) {
        initialStates.set(p.id, {
          id: p.id,
          name: p.name,
          source: p.source,
          status: 'searching',
          resultCount: 0,
        });
      }
      setProviderStates(initialStates);

      // Run all providers in parallel.
      const results: SearchResult[] = [];
      const allSuggestions: string[] = [];

      const settled = await Promise.allSettled(
        activeProviders.map(async (provider) => {
          const start = performance.now();
          try {
            const response: ProviderSearchResponse = await provider.search({
              query: query.trim(),
              signal,
            });

            const latencyMs = Math.round(performance.now() - start);

            updateProviderState(provider.id, {
              status: 'done',
              resultCount: response.results.length,
              latencyMs,
            });

            return response;
          } catch {
            const latencyMs = Math.round(performance.now() - start);
            updateProviderState(provider.id, {
              status: 'error',
              resultCount: 0,
              latencyMs,
            });
            return { results: [], suggestions: [] } as ProviderSearchResponse;
          }
        }),
      );

      for (const s of settled) {
        if (s.status === 'fulfilled') {
          results.push(...s.value.results);
          if (s.value.suggestions) allSuggestions.push(...s.value.suggestions);
        }
      }

      // Deduplicate by URL (prefer the result with the higher score).
      const deduped = deduplicateResults(results);

      // Sort by score descending, then by recency.
      deduped.sort((a, b) => {
        const scoreDiff = (b.score ?? 0) - (a.score ?? 0);
        if (Math.abs(scoreDiff) > 5) return scoreDiff;
        return (b.timestamp ?? 0) - (a.timestamp ?? 0);
      });

      return {
        results: deduped,
        suggestions: [...new Set(allSuggestions)].slice(0, 8),
      };
    },
    enabled: enabled && query.trim().length > 0,
    staleTime: 30_000,
    retry: 0,
    placeholderData: (prev) => prev,
  });

  const allResults = data?.results ?? [];
  const suggestions = data?.suggestions ?? [];

  // Reset provider states when query clears.
  const providers = useMemo(() => {
    if (!query.trim()) return [];
    return activeProviders.map((p) => providerStates.get(p.id) ?? {
      id: p.id,
      name: p.name,
      source: p.source,
      status: 'idle' as const,
      resultCount: 0,
    });
  }, [activeProviders, providerStates, query]);

  const isLoading = providers.some((p) => p.status === 'searching');
  const isEmpty = query.trim().length > 0 && !isLoading && allResults.length === 0;

  // Auto-index: publish useful web results to the shared Nostr index (SIP-01).
  const indexedQueryRef = useRef('');
  useEffect(() => {
    if (
      allResults.length > 0 &&
      query.trim() &&
      !isLoading &&
      indexedQueryRef.current !== query
    ) {
      indexedQueryRef.current = query;
      void indexResults(query, allResults);
    }
  }, [allResults, query, isLoading, indexResults]);

  // Counts per source.
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: allResults.length };
    for (const r of allResults) {
      c[r.source] = (c[r.source] ?? 0) + 1;
    }
    return c as Record<SearchSource | 'all', number>;
  }, [allResults]);

  // Invalidate stale queries when source changes.
  const prevSourceRef = useRef(source);
  if (prevSourceRef.current !== source) {
    prevSourceRef.current = source;
    if (query.trim()) {
      queryClient.invalidateQueries({ queryKey: ['provider-search', query, source] });
    }
  }

  return {
    results: allResults,
    providers,
    isLoading,
    isFetching,
    isEmpty,
    suggestions,
    counts,
  };
}

/** Deduplicate results by normalized URL. Prefer higher-scored versions. */
function deduplicateResults(results: SearchResult[]): SearchResult[] {
  const map = new Map<string, SearchResult>();

  for (const r of results) {
    const key = normalizeUrl(r.url) || r.id;
    const existing = map.get(key);
    if (!existing || (r.score ?? 0) > (existing.score ?? 0)) {
      map.set(key, r);
    }
  }

  return [...map.values()];
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`.replace(/\/$/, '').toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

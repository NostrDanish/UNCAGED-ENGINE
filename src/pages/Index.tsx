import { useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSeoMeta } from '@unhead/react';
import { Search } from 'lucide-react';

import { Layout } from '@/components/Layout';
import { SearchBar } from '@/components/SearchBar';
import { SourceTabs, type SourceTabValue } from '@/components/SourceTabs';
import { UnifiedResultCard } from '@/components/UnifiedResultCard';
import { ProviderStatus } from '@/components/ProviderStatus';
import { SearchSkeleton } from '@/components/SearchSkeleton';
import { Card, CardContent } from '@/components/ui/card';
import { useProviderSearch } from '@/hooks/useProviderSearch';
import { useSearchHotkeys } from '@/hooks/useSearchHotkeys';

const Index = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get('q') || '';
  const initialSource = (searchParams.get('source') as SourceTabValue) || 'all';

  const [query, setQuery] = useState(initialQuery);
  const [activeQuery, setActiveQuery] = useState(initialQuery);
  const [source, setSource] = useState<SourceTabValue>(initialSource);

  const hasSearched = activeQuery.length > 0;

  // Global hotkeys: Ctrl+K / Cmd+K and "/" focus the search bar.
  useSearchHotkeys();

  const {
    results,
    providers,
    isLoading,
    isFetching,
    isEmpty,
    suggestions,
    counts,
  } = useProviderSearch({
    query: activeQuery,
    source,
    enabled: hasSearched,
  });

  // Filter results for the current source tab.
  const filteredResults = useMemo(() => {
    if (source === 'all') return results;
    return results.filter((r) => r.source === source);
  }, [results, source]);

  const totalResults = filteredResults.length;

  useSeoMeta({
    title: hasSearched ? `${activeQuery} - Uncaged Engine` : 'Uncaged Engine - Nostr Search Engine Template',
    description: 'A minimal Nostr-native search engine. NIP-50 relay search, a shared decentralized web index, and community-curated links. No backend, no tracking.',
  });

  const handleSubmit = useCallback((value: string) => {
    setActiveQuery(value);
    setSearchParams((prev) => {
      prev.set('q', value);
      prev.set('source', source);
      return prev;
    });
  }, [source, setSearchParams]);

  const handleSourceChange = useCallback((newSource: SourceTabValue) => {
    setSource(newSource);
    if (activeQuery) {
      setSearchParams((prev) => {
        prev.set('source', newSource);
        return prev;
      });
    }
  }, [activeQuery, setSearchParams]);

  // ─── Hero mode (no search yet) ───
  if (!hasSearched) {
    return (
      <Layout minimal>
        <div className="flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] px-4">
          <div className="text-center mb-10 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4 motion-safe:duration-700">
            <div className="flex items-center justify-center mb-6">
              <div className="relative">
                <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 glow-primary-lg">
                  <Search className="w-8 h-8 text-primary" />
                </div>
                <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-primary animate-search-pulse" />
              </div>
            </div>
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight mb-4">
              <span className="text-foreground">Uncaged</span>
              <span className="text-primary font-mono">Engine</span>
            </h1>
            <p className="text-lg sm:text-xl text-muted-foreground max-w-lg mx-auto leading-relaxed">
              Search Nostr and the shared web index. No backend. No tracking.
            </p>
          </div>

          <div className="w-full max-w-2xl mb-6 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-500 motion-safe:delay-200">
            <SearchBar
              value={query}
              onChange={setQuery}
              onSubmit={handleSubmit}
              size="large"
              autoFocus
            />
          </div>

          <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:duration-500 motion-safe:delay-300">
            <SourceTabs value={source} onChange={handleSourceChange} />
          </div>

          <p className="mt-8 text-xs text-muted-foreground/60 text-center max-w-md leading-relaxed motion-safe:animate-in motion-safe:fade-in motion-safe:duration-500 motion-safe:delay-500">
            Every provider reads from Nostr relays. Your query never leaves the network,
            and auto-indexing never publishes it — only the public pages it surfaces.
          </p>
        </div>
      </Layout>
    );
  }

  // ─── Results mode ───
  return (
    <Layout>
      <div className="container py-6">
        <div className="max-w-2xl mb-5">
          <SearchBar
            value={query}
            onChange={setQuery}
            onSubmit={handleSubmit}
            isLoading={isFetching}
          />
        </div>

        {/* Tabs + provider status */}
        <div className="flex flex-col gap-3 mb-6">
          <SourceTabs value={source} onChange={handleSourceChange} counts={hasSearched ? counts : undefined} />
          {providers.length > 0 && (
            <ProviderStatus providers={providers} hasResults={totalResults > 0} />
          )}
        </div>

        <div className="max-w-2xl">
          {/* Loading state */}
          {isLoading && totalResults === 0 ? (
            <SearchSkeleton />
          ) : isEmpty ? (
            <Card className="border-dashed">
              <CardContent className="py-12 px-8 text-center">
                <Search className="w-8 h-8 mx-auto mb-3 text-muted-foreground/40" />
                <p className="text-muted-foreground max-w-sm mx-auto">
                  No results found for &ldquo;{activeQuery}&rdquo;. Try different terms,
                  or submit a link to the index with the Submit button above.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {/* Result count header */}
              {totalResults > 0 && (
                <p className="text-sm text-muted-foreground mb-1">
                  {totalResults} result{totalResults !== 1 ? 's' : ''}
                  {source === 'all' && providers.some((p) => p.status === 'searching') && (
                    <span className="ml-2 text-primary animate-search-pulse">more loading...</span>
                  )}
                </p>
              )}

              {/* Results */}
              {filteredResults.map((result) => (
                <UnifiedResultCard key={result.id} result={result} />
              ))}

              {/* Suggestions */}
              {suggestions.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap pt-2">
                  <span className="text-xs text-muted-foreground">Related:</span>
                  {suggestions.slice(0, 5).map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => {
                        setQuery(suggestion);
                        handleSubmit(suggestion);
                      }}
                      className="text-xs px-2 py-1 rounded-md border border-border/50 text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default Index;

/**
 * Search providers — barrel export.
 */
export type {
  SearchResult,
  SearchSource,
  SearchProvider,
  SearchOptions,
  ProviderSearchResponse,
} from './types';

export { webIndexProvider } from './web-index';
export { nostrProvider } from './nostr';
export { communityProvider } from './community';
export { ALL_PROVIDERS, getProvidersForSource, getProvider, getAvailableSources } from './registry';

/**
 * Universal result card — renders any SearchResult from any provider.
 *
 * - Nostr profile results: avatar-forward layout
 * - Other Nostr results (notes, articles, files): internal /:nip19 link
 * - Web results (index observations, community links): external link card,
 *   with owner-managed affiliate tagging + click attribution
 *
 * Result URLs are hostile data (external engines, public relays, community
 * submissions) — they pass sanitizeResultUrl() before becoming a href, and
 * an unsafe scheme renders the card WITHOUT a link wrapper.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Globe, ExternalLink, Zap, User, FileText, Flag } from 'lucide-react';

import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { ReportDialog } from '@/components/ReportDialog';
import { sanitizeResultUrl } from '@/lib/sanitizeUrl';
import { useAffiliateRules } from '@/hooks/useAffiliates';
import { applyAffiliateRules } from '@/lib/affiliates';
import { trackAffiliateClick } from '@/hooks/useReferrals';
import type { SearchResult } from '@/lib/providers/types';
import { cn } from '@/lib/utils';

interface UnifiedResultCardProps {
  result: SearchResult;
  className?: string;
}

export function UnifiedResultCard({ result, className }: UnifiedResultCardProps) {
  // Nostr profile results get a distinct layout.
  if (result.source === 'nostr' && result.kind === 'Profile') {
    return <NostrProfileCard result={result} className={className} />;
  }

  // Nostr results with internal links.
  if (result.source === 'nostr') {
    return <NostrCard result={result} className={className} />;
  }

  // External results (web index, community).
  return <ExternalResultCard result={result} className={className} />;
}

/* ─── Nostr profile ─── */
function NostrProfileCard({ result, className }: { result: SearchResult; className?: string }) {
  return (
    <Link to={result.url} className={cn('block group', className)}>
      <div className="flex items-start gap-4 p-4 rounded-xl border border-border/50 bg-card hover:border-primary/30 hover:bg-card/80 transition-all duration-200">
        <Avatar size="lg" className="shrink-0 ring-2 ring-primary/10">
          {result.authorAvatar && <AvatarImage src={result.authorAvatar} alt={result.title} />}
          <AvatarFallback><User className="w-5 h-5" /></AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-semibold text-foreground group-hover:text-primary transition-colors truncate">
              {result.title}
            </span>
            <Badge variant="outline" className="text-[10px] shrink-0 border-primary/30 text-primary">
              Profile
            </Badge>
          </div>
          {result.domain && (
            <p className="text-xs text-muted-foreground font-mono mb-1.5 truncate">{result.domain}</p>
          )}
          {result.snippet && (
            <p className="text-sm text-muted-foreground line-clamp-2">{result.snippet}</p>
          )}
        </div>
      </div>
    </Link>
  );
}

/* ─── Nostr note / article / file ─── */
function NostrCard({ result, className }: { result: SearchResult; className?: string }) {
  const [reportOpen, setReportOpen] = useState(false);

  return (
    <>
      <Link to={result.url} className={cn('block group', className)}>
        <div className="p-4 rounded-xl border border-border/50 bg-card hover:border-primary/30 hover:bg-card/80 transition-all duration-200">
          {/* Header */}
          <div className="flex items-center gap-2 mb-2.5">
            {result.authorAvatar && (
              <Avatar size="sm" className="shrink-0">
                <AvatarImage src={result.authorAvatar} alt={result.author || ''} />
                <AvatarFallback>{(result.author || '?').charAt(0).toUpperCase()}</AvatarFallback>
              </Avatar>
            )}
            {result.author && (
              <span className="text-sm text-muted-foreground truncate">{result.author}</span>
            )}
            {result.timestamp && (
              <span className="text-xs text-muted-foreground/60">{timeAgo(result.timestamp)}</span>
            )}
            {result.kind && (
              <Badge variant="outline" className="text-[10px] ml-auto shrink-0 border-primary/30 text-primary">
                {result.kind === 'Article' && <FileText className="w-3 h-3 mr-0.5" />}
                {result.kind}
              </Badge>
            )}
          </div>

          {/* Title (for articles) */}
          {result.kind === 'Article' && result.title !== result.snippet && (
            <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors mb-1.5 line-clamp-2">
              {result.title}
            </h3>
          )}

          {/* Content / snippet */}
          <p className="text-sm text-foreground/90 leading-relaxed line-clamp-4 whitespace-pre-wrap break-words">
            {result.snippet}
          </p>

          {/* Tags + report */}
          <div className="flex items-center gap-1.5 mt-3">
            {result.tags && result.tags.length > 0 && (
              <>
                {result.tags.slice(0, 4).map((tag) => (
                  <span key={tag} className="text-xs text-primary/60 font-mono">#{tag}</span>
                ))}
              </>
            )}
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); setReportOpen(true); }}
              className="ml-auto inline-flex items-center p-1 rounded-md text-muted-foreground/50 hover:text-destructive transition-colors"
              aria-label="Report this result"
              title="Report this result (NIP-56)"
            >
              <Flag className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </Link>

      {result.nostrEvent && (
        <ReportDialog
          open={reportOpen}
          onOpenChange={setReportOpen}
          target={result.nostrEvent.id}
          targetTitle={result.title}
        />
      )}
    </>
  );
}

/* ─── External result (web index, community) ─── */
function ExternalResultCard({ result, className }: { result: SearchResult; className?: string }) {
  const [reportOpen, setReportOpen] = useState(false);
  // Owner-managed affiliate tagging (e.g. a host rule adds ?tag=code).
  // Applied before sanitization so the final href is always clean.
  const { rules: affiliateRules } = useAffiliateRules();
  const taggedUrl = applyAffiliateRules(result.url, affiliateRules);
  const safeUrl = sanitizeResultUrl(taggedUrl);

  const card = (
    <div className="p-4 rounded-xl border border-border/50 bg-card hover:border-primary/30 hover:bg-card/80 transition-all duration-200">
      {/* URL line */}
      <div className="flex items-center gap-2 mb-1.5">
        <span className="shrink-0 text-muted-foreground/60">
          {result.provider === 'community' ? <Zap className="w-3 h-3" /> : <Globe className="w-3 h-3" />}
        </span>
        <span className="text-xs text-muted-foreground font-mono truncate">
          {result.domain || result.engine || result.provider}
        </span>
        {safeUrl && (
          <ExternalLink className="w-3 h-3 text-muted-foreground/40 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
        )}
        {(result.kind || result.engine) && (
          <span className="flex items-center gap-1.5 ml-auto shrink-0">
            {result.kind && (
              <Badge variant="outline" className="text-[10px] border-border text-muted-foreground">
                {result.kind}
              </Badge>
            )}
            {result.engine && (
              <Badge variant="outline" className="text-[10px] border-border text-muted-foreground">
                {result.engine}
              </Badge>
            )}
          </span>
        )}
      </div>

      {/* Title */}
      <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors mb-1 line-clamp-2 text-sm">
        {result.title}
      </h3>

      {/* Snippet */}
      {result.snippet && (
        <p className="text-sm text-muted-foreground line-clamp-3 leading-relaxed">
          {result.snippet}
        </p>
      )}

      {/* Footer: author, timestamp, tags, report */}
      <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground/60 flex-wrap">
        {result.author && <span>by {result.author}</span>}
        {result.timestamp && <span>{timeAgo(result.timestamp)}</span>}
        {result.tags && result.tags.length > 0 && (
          <span className="font-mono">{result.tags.join(' · ')}</span>
        )}
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setReportOpen(true); }}
          className="ml-auto inline-flex items-center gap-1 text-muted-foreground/50 hover:text-destructive transition-colors"
          aria-label="Report this result"
          title="Report this result (NIP-56)"
        >
          <Flag className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );

  return (
    <>
      {safeUrl ? (
        <a
          href={safeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={cn('block group', className)}
          onClick={() => trackAffiliateClick(result.url, taggedUrl)}
        >
          {card}
        </a>
      ) : (
        // Unsafe scheme (javascript:, data:, ipfs: without a gateway, …) —
        // render the card without a link.
        <div className={className}>{card}</div>
      )}

      <ReportDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        target={result.nostrEvent?.id ?? result.url}
        targetTitle={result.title}
      />
    </>
  );
}

/* ─── Utilities ─── */
function timeAgo(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - timestamp;

  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 2592000) return `${Math.floor(diff / 604800)}w ago`;

  const date = new Date(timestamp * 1000);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

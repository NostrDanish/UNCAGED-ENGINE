import { cn } from '@/lib/utils';
import { Layers, Zap, Globe } from 'lucide-react';
import type { SearchSource } from '@/lib/providers/types';

export type SourceTabValue = SearchSource | 'all';

interface SourceTabsProps {
  value: SourceTabValue;
  onChange: (source: SourceTabValue) => void;
  className?: string;
  /** Optional result counts to show in badges. */
  counts?: Partial<Record<SourceTabValue, number>>;
}

const sources: { id: SourceTabValue; label: string; icon: React.ReactNode }[] = [
  { id: 'all', label: 'All', icon: <Layers className="w-3.5 h-3.5" /> },
  { id: 'nostr', label: 'Nostr', icon: <Zap className="w-3.5 h-3.5" /> },
  { id: 'web', label: 'Web', icon: <Globe className="w-3.5 h-3.5" /> },
];

export function SourceTabs({ value, onChange, className, counts }: SourceTabsProps) {
  return (
    <div className={cn('flex items-center gap-1.5 flex-wrap', className)} role="tablist" aria-label="Search source">
      {sources.map((source) => {
        const isActive = value === source.id;
        const count = counts?.[source.id];
        return (
          <button
            key={source.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(source.id)}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-transparent transition-all duration-150',
              isActive
                ? 'text-[var(--primary)] bg-[var(--primary)]/10 border-[var(--primary)]/30'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent',
            )}
          >
            {source.icon}
            {source.label}
            {count !== undefined && count > 0 && (
              <span className="text-[10px] font-mono ml-0.5 opacity-70">
                {count > 99 ? '99+' : count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
